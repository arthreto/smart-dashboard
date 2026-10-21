#include "capture_tab5.h"

#include <bsp/m5stack_tab5.h>
#include <driver/ledc.h>
#include <esp_heap_caps.h>
#include <esp_log.h>
#include <esp_timer.h>
#include <fcntl.h>
#include <sys/ioctl.h>
#include <sys/mman.h>
#include <unistd.h>

#include <cerrno>
#include <cstring>
#include <vector>

#include "esp_aac_enc.h"
#include "esp_video_device.h"
#include "esp_video_init.h"
#include "linux/videodev2.h"

namespace {

const char* TAG = "camera";

constexpr int CAM_BUFFERS = 3;
constexpr int H264_BITRATE = 2000000;  // 2 Mb/s (maximum de l'encodeur : 2,5 Mb/s)
constexpr int H264_GOP = 30;            // une image clé par seconde (pour se déplacer dans la vidéo)
constexpr int AUDIO_RATE = 48000;
constexpr int AUDIO_BITRATE = 64000;
constexpr float MIC_GAIN_DB = 30.0f;
// Trame de référence de l'encodeur H.264 à 1280 de large : ~92 Ko ; on réserve un peu plus,
// aligné sur la ligne de cache (128 o), pour la lui garantir d'un seul tenant.
constexpr size_t RESERVE_BYTES = 100 * 1024;

/** Vrai si le flux H.264 (Annex B) contient une image IDR ou des paramètres SPS. */
bool hasKeyNal(const uint8_t* p, size_t n) {
    for (size_t i = 0; i + 3 < n; i++) {
        if (p[i] == 0 && p[i + 1] == 0 && (p[i + 2] == 1 || (p[i + 2] == 0 && i + 4 < n && p[i + 3] == 1))) {
            size_t h = p[i + 2] == 1 ? i + 3 : i + 4;
            if (h >= n) break;
            int type = p[h] & 0x1F;
            if (type == 5 || type == 7) return true;
            i = h;
        }
    }
    return false;
}

/** Message d'erreur avec l'errno, pour savoir précisément ce qui a échoué sur l'écran. */
std::string errMsg(const char* what) {
    char buf[96];
    std::snprintf(buf, sizeof buf, "%s (err %d : %s)", what, errno, strerror(errno));
    return buf;
}

bool setCtrl(int fd, uint32_t id, int32_t value) {
    struct v4l2_ext_controls controls = {};
    struct v4l2_ext_control control[1] = {};
    controls.ctrl_class = V4L2_CID_CODEC_CLASS;
    controls.count = 1;
    controls.controls = control;
    control[0].id = id;
    control[0].value = value;
    return ioctl(fd, VIDIOC_S_EXT_CTRLS, &controls) == 0;
}

}  // namespace

/**
 * Horloge 24 MHz du capteur (GPIO 36), comme bsp_cam_osc_init() de M5Stack, mais sur un
 * minuteur LEDC à part : le minuteur 0 sert au rétroéclairage (5 kHz), qui l'écraserait.
 */
static void camClock() {
    ledc_timer_config_t timer = {};
    timer.speed_mode = LEDC_LOW_SPEED_MODE;
    timer.duty_resolution = LEDC_TIMER_1_BIT;
    timer.timer_num = LEDC_TIMER_2;
    timer.freq_hz = 24000000;
    timer.clk_cfg = LEDC_AUTO_CLK;
    if (ledc_timer_config(&timer) != ESP_OK) ESP_LOGE(TAG, "horloge du capteur : minuteur refusé");
    ledc_channel_config_t ch = {};
    ch.gpio_num = 36;
    ch.speed_mode = LEDC_LOW_SPEED_MODE;
    ch.channel = LEDC_CHANNEL_2;
    ch.intr_type = LEDC_INTR_DISABLE;
    ch.timer_sel = LEDC_TIMER_2;
    ch.duty = 1;
    ch.hpoint = 0;
    if (ledc_channel_config(&ch) != ESP_OK) ESP_LOGE(TAG, "horloge du capteur : canal refusé");
}

bool Tab5Capture::initCamera(std::string* error) {
    if (videoInit_) return true;
    camClock();
    vTaskDelay(pdMS_TO_TICKS(20));
    static esp_video_init_csi_config_t csi = {};
    csi.sccb_config.init_sccb = false;
    csi.sccb_config.i2c_handle = bsp_i2c_get_handle();
    csi.sccb_config.freq = 400000;
    csi.reset_pin = -1;
    csi.pwdn_pin = -1;
    static esp_video_init_config_t cfg = {};
    cfg.csi = &csi;
    esp_err_t err = esp_video_init(&cfg);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "esp_video_init : %s", esp_err_to_name(err));
        *error = "Caméra introuvable";
        return false;
    }
    videoInit_ = true;
    return true;
}

void Tab5Capture::reserveInternal() {
    if (reserve_ || running_) return;
    reserve_ = heap_caps_aligned_alloc(128, RESERVE_BYTES, MALLOC_CAP_INTERNAL);
    if (!reserve_) ESP_LOGW(TAG, "réserve de RAM interne impossible (%u o) : l'encodeur pourrait manquer de mémoire", static_cast<unsigned>(RESERVE_BYTES));
}

bool Tab5Capture::openPipeline(std::string* error) {
    // --- Caméra : format du capteur, sortie YUV420 par l'ISP ---
    camFd_ = open(ESP_VIDEO_MIPI_CSI_DEVICE_NAME, O_RDONLY);
    if (camFd_ < 0) {
        *error = errMsg("Caméra absente ou non branchée");
        return false;
    }
    struct v4l2_format fmt = {};
    fmt.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    if (ioctl(camFd_, VIDIOC_G_FMT, &fmt) != 0) {
        *error = errMsg("Caméra : format inconnu");
        return false;
    }
    width_ = static_cast<int>(fmt.fmt.pix.width);
    height_ = static_cast<int>(fmt.fmt.pix.height);
    ESP_LOGI(TAG, "capteur %dx%d", width_, height_);
    struct v4l2_format want = {};
    want.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    want.fmt.pix.width = width_;
    want.fmt.pix.height = height_;
    want.fmt.pix.pixelformat = V4L2_PIX_FMT_YUV420;
    if (ioctl(camFd_, VIDIOC_S_FMT, &want) != 0) {
        *error = errMsg("Caméra : YUV420 refusé");
        return false;
    }
    struct v4l2_requestbuffers req = {};
    req.count = CAM_BUFFERS;
    req.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    req.memory = V4L2_MEMORY_MMAP;
    if (ioctl(camFd_, VIDIOC_REQBUFS, &req) != 0) {
        *error = errMsg("Caméra : mémoire insuffisante");
        return false;
    }
    for (int i = 0; i < CAM_BUFFERS; i++) {
        struct v4l2_buffer buf = {};
        buf.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
        buf.memory = V4L2_MEMORY_MMAP;
        buf.index = i;
        if (ioctl(camFd_, VIDIOC_QUERYBUF, &buf) != 0) {
            *error = "Caméra : tampon refusé";
            return false;
        }
        camBuf_[i] = static_cast<uint8_t*>(mmap(nullptr, buf.length, PROT_READ | PROT_WRITE, MAP_SHARED, camFd_, buf.m.offset));
        camBufLen_[i] = buf.length;
        if (!camBuf_[i] || ioctl(camFd_, VIDIOC_QBUF, &buf) != 0) {
            *error = "Caméra : tampon refusé";
            return false;
        }
    }

    // --- Encodeur H.264 matériel (mémoire à mémoire) ---
    encFd_ = open(ESP_VIDEO_H264_DEVICE_NAME, O_RDONLY);
    if (encFd_ < 0) {
        *error = errMsg("Encodeur H.264 indisponible");
        return false;
    }
    if (!setCtrl(encFd_, V4L2_CID_MPEG_VIDEO_H264_I_PERIOD, H264_GOP)) ESP_LOGW(TAG, "période des images clés refusée");
    if (!setCtrl(encFd_, V4L2_CID_MPEG_VIDEO_BITRATE, H264_BITRATE)) ESP_LOGW(TAG, "débit refusé");
    if (!setCtrl(encFd_, V4L2_CID_MPEG_VIDEO_H264_MIN_QP, 20)) ESP_LOGW(TAG, "QP min refusé");
    if (!setCtrl(encFd_, V4L2_CID_MPEG_VIDEO_H264_MAX_QP, 42)) ESP_LOGW(TAG, "QP max refusé");

    struct v4l2_format out = {};
    out.type = V4L2_BUF_TYPE_VIDEO_OUTPUT;
    out.fmt.pix.width = width_;
    out.fmt.pix.height = height_;
    out.fmt.pix.pixelformat = V4L2_PIX_FMT_YUV420;
    struct v4l2_requestbuffers outReq = {};
    outReq.count = 1;
    outReq.type = V4L2_BUF_TYPE_VIDEO_OUTPUT;
    outReq.memory = V4L2_MEMORY_USERPTR;
    struct v4l2_format cap = {};
    cap.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    cap.fmt.pix.width = width_;
    cap.fmt.pix.height = height_;
    cap.fmt.pix.pixelformat = V4L2_PIX_FMT_H264;
    struct v4l2_requestbuffers capReq = {};
    capReq.count = 1;
    capReq.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    capReq.memory = V4L2_MEMORY_MMAP;
    if (ioctl(encFd_, VIDIOC_S_FMT, &out) != 0 || ioctl(encFd_, VIDIOC_REQBUFS, &outReq) != 0 ||
        ioctl(encFd_, VIDIOC_S_FMT, &cap) != 0 || ioctl(encFd_, VIDIOC_REQBUFS, &capReq) != 0) {
        *error = errMsg("Encodeur H.264 : configuration refusée");
        return false;
    }
    struct v4l2_buffer buf = {};
    buf.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    buf.memory = V4L2_MEMORY_MMAP;
    buf.index = 0;
    if (ioctl(encFd_, VIDIOC_QUERYBUF, &buf) != 0) {
        *error = "Encodeur H.264 : tampon refusé";
        return false;
    }
    encBuf_ = static_cast<uint8_t*>(mmap(nullptr, buf.length, PROT_READ | PROT_WRITE, MAP_SHARED, encFd_, buf.m.offset));
    encBufLen_ = buf.length;
    if (!encBuf_ || ioctl(encFd_, VIDIOC_QBUF, &buf) != 0) {
        *error = "Encodeur H.264 : tampon refusé";
        return false;
    }

    // Juste avant que l'encodeur n'alloue sa trame de référence : on rend la RAM interne
    // réservée au démarrage, pour qu'il s'y serve sur un bloc contigu encore intact.
    if (reserve_) {
        heap_caps_free(reserve_);
        reserve_ = nullptr;
    }
    ESP_LOGI(TAG, "RAM interne libre avant l'encodeur : %u o (plus grand bloc %u o)",
             static_cast<unsigned>(heap_caps_get_free_size(MALLOC_CAP_INTERNAL)),
             static_cast<unsigned>(heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL)));

    int type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    if (ioctl(encFd_, VIDIOC_STREAMON, &type) != 0) {
        *error = errMsg("H.264 : démarrage (capture) impossible");
        return false;
    }
    type = V4L2_BUF_TYPE_VIDEO_OUTPUT;
    if (ioctl(encFd_, VIDIOC_STREAMON, &type) != 0) {
        *error = errMsg("H.264 : démarrage (sortie) impossible");
        return false;
    }
    type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    if (ioctl(camFd_, VIDIOC_STREAMON, &type) != 0) {
        *error = errMsg("Caméra : démarrage du flux impossible");
        return false;
    }
    return true;
}

void Tab5Capture::closePipeline() {
    int type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    if (camFd_ >= 0) {
        ioctl(camFd_, VIDIOC_STREAMOFF, &type);
        for (int i = 0; i < CAM_BUFFERS; i++) {
            if (camBuf_[i]) munmap(camBuf_[i], camBufLen_[i]);
            camBuf_[i] = nullptr;
        }
        close(camFd_);
        camFd_ = -1;
    }
    if (encFd_ >= 0) {
        type = V4L2_BUF_TYPE_VIDEO_OUTPUT;
        ioctl(encFd_, VIDIOC_STREAMOFF, &type);
        type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
        ioctl(encFd_, VIDIOC_STREAMOFF, &type);
        if (encBuf_) munmap(encBuf_, encBufLen_);
        encBuf_ = nullptr;
        close(encFd_);
        encFd_ = -1;
    }
    // L'encodeur a rendu sa mémoire : on reprend la réserve pour le prochain enregistrement.
    reserveInternal();
}

bool Tab5Capture::start(hal::MediaSink* sink, hal::CaptureInfo* info, std::string* error) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (running_) {
        *error = "Enregistrement déjà en cours";
        return false;
    }
    if (!initCamera(error)) return false;
    if (!openPipeline(error)) {
        ESP_LOGE(TAG, "%s", error->c_str());
        closePipeline();
        return false;
    }
    if (!videoDone_) videoDone_ = xSemaphoreCreateBinary();
    if (!audioDone_) audioDone_ = xSemaphoreCreateBinary();

    sink_ = sink;
    info->width = width_;
    info->height = height_;
    info->fps = 30;
    info->audioRate = AUDIO_RATE;
    info->audioChannels = 1;
    // AudioSpecificConfig : AAC-LC (2), 48 kHz (indice 3), mono (1).
    info->audioConfig = std::string("\x11\x88", 2);
    t0_ = esp_timer_get_time();
    running_ = true;
    audioOn_ = true;
    xTaskCreatePinnedToCore(videoTaskMain, "cam_rec", 6144, this, 7, nullptr, 1);
    xTaskCreatePinnedToCore(audioTaskMain, "mic_rec", 8192, this, 8, nullptr, 1);
    ESP_LOGI(TAG, "enregistrement démarré (%dx%d)", width_, height_);
    return true;
}

void Tab5Capture::stop() {
    std::lock_guard<std::mutex> lock(mutex_);
    if (!running_) return;
    running_ = false;
    xSemaphoreTake(videoDone_, pdMS_TO_TICKS(3000));
    if (audioOn_) xSemaphoreTake(audioDone_, pdMS_TO_TICKS(3000));
    closePipeline();
    sink_ = nullptr;
    ESP_LOGI(TAG, "enregistrement arrêté");
}

void Tab5Capture::videoTaskMain(void* arg) {
    auto* self = static_cast<Tab5Capture*>(arg);
    self->videoLoop();
    xSemaphoreGive(self->videoDone_);
    vTaskDelete(nullptr);
}

void Tab5Capture::audioTaskMain(void* arg) {
    auto* self = static_cast<Tab5Capture*>(arg);
    self->audioLoop();
    xSemaphoreGive(self->audioDone_);
    vTaskDelete(nullptr);
}

void Tab5Capture::videoLoop() {
    while (running_) {
        struct v4l2_buffer camBuf = {};
        camBuf.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
        camBuf.memory = V4L2_MEMORY_MMAP;
        if (ioctl(camFd_, VIDIOC_DQBUF, &camBuf) != 0) {
            ESP_LOGE(TAG, "image de la caméra perdue");
            vTaskDelay(pdMS_TO_TICKS(20));
            continue;
        }
        int64_t pts = esp_timer_get_time() - t0_;

        struct v4l2_buffer in = {};
        in.index = 0;
        in.type = V4L2_BUF_TYPE_VIDEO_OUTPUT;
        in.memory = V4L2_MEMORY_USERPTR;
        in.m.userptr = reinterpret_cast<unsigned long>(camBuf_[camBuf.index]);
        in.length = camBuf.bytesused;
        struct v4l2_buffer outBuf = {};
        outBuf.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
        outBuf.memory = V4L2_MEMORY_MMAP;
        bool encoded = ioctl(encFd_, VIDIOC_QBUF, &in) == 0 && ioctl(encFd_, VIDIOC_DQBUF, &outBuf) == 0;
        ioctl(camFd_, VIDIOC_QBUF, &camBuf);
        if (encoded) {
            ioctl(encFd_, VIDIOC_DQBUF, &in);
            hal::MediaPacket p;
            p.video = true;
            p.ptsUs = pts;
            p.data.assign(reinterpret_cast<const char*>(encBuf_), outBuf.bytesused);
            p.key = hasKeyNal(encBuf_, outBuf.bytesused);
            outBuf.index = 0;
            ioctl(encFd_, VIDIOC_QBUF, &outBuf);
            if (sink_ && running_) sink_->onPacket(std::move(p));
        } else {
            ESP_LOGE(TAG, "compression H.264 impossible");
            vTaskDelay(pdMS_TO_TICKS(20));
        }
    }
}

void Tab5Capture::audioLoop() {
    esp_aac_enc_config_t cfg = ESP_AAC_ENC_CONFIG_DEFAULT();
    cfg.sample_rate = AUDIO_RATE;
    cfg.channel = 1;
    cfg.bits_per_sample = 16;
    cfg.bitrate = AUDIO_BITRATE;
    cfg.adts_used = false;
    void* enc = nullptr;
    if (esp_aac_enc_open(&cfg, sizeof cfg, &enc) != ESP_AUDIO_ERR_OK || !enc) {
        ESP_LOGE(TAG, "encodeur AAC indisponible : vidéo sans son");
        audioOn_ = false;
        return;
    }
    int inSize = 0, outSize = 0;
    esp_aac_enc_get_frame_size(enc, &inSize, &outSize);
    const int samples = inSize / 2;  // mono 16 bits (1024 échantillons)
    std::vector<int16_t> tdm(static_cast<size_t>(samples) * 4);
    std::vector<int16_t> mono(samples);
    std::vector<uint8_t> out(outSize);

    bsp_codec_config_t* codec = bsp_get_codec_handle();
    codec->set_in_gain(MIC_GAIN_DB);
    int64_t frames = 0;
    while (running_) {
        // ES7210 en TDM : 4 voies [micro gauche, référence, micro droit, micro casque].
        size_t got = 0;
        if (codec->i2s_read(tdm.data(), tdm.size() * sizeof(int16_t), &got, 200) != ESP_OK || got < tdm.size() * sizeof(int16_t)) {
            if (!running_) break;
            continue;
        }
        for (int i = 0; i < samples; i++) mono[i] = static_cast<int16_t>((tdm[i * 4] + tdm[i * 4 + 2]) / 2);
        esp_audio_enc_in_frame_t inFrame = {reinterpret_cast<uint8_t*>(mono.data()), static_cast<uint32_t>(inSize)};
        esp_audio_enc_out_frame_t outFrame = {out.data(), static_cast<uint32_t>(outSize), 0, 0};
        if (esp_aac_enc_process(enc, &inFrame, &outFrame) == ESP_AUDIO_ERR_OK && outFrame.encoded_bytes > 0) {
            hal::MediaPacket p;
            p.video = false;
            p.key = true;
            p.ptsUs = frames * samples * 1000000LL / AUDIO_RATE;
            p.data.assign(reinterpret_cast<const char*>(out.data()), outFrame.encoded_bytes);
            if (sink_ && running_) sink_->onPacket(std::move(p));
        }
        frames++;
    }
    esp_aac_enc_close(enc);
}
