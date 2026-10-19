// Hardware for the round device (a Waveshare ESP32-S3-Touch-AMOLED-1.75-style
// board: its stock firmware reports a CST816S touch chip and an AXP2101).
//
// Pins are from Waveshare's board support package. The 1.75 and 1.75C differ
// only in the reset pins (LCD 39 / touch 40 vs LCD 1 / touch 2). Neither board
// uses the other's pair for anything that matters here, so both pairs are
// pulsed at start-up and the drivers are told there's no reset pin.
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/gpio.h"
#include "driver/i2c_master.h"
#include "driver/i2s_std.h"
#include "driver/spi_master.h"
#include "esp_check.h"
#include "esp_codec_dev.h"
#include "esp_codec_dev_defaults.h"
#include "esp_heap_caps.h"
#include "esp_lcd_co5300.h"
#include "esp_lcd_panel_io.h"
#include "esp_lcd_panel_ops.h"
#include "esp_lcd_touch_cst816s.h"
#include "esp_log.h"
#include "esp_lvgl_port.h"
#include <string.h>
#include "board.h"

static const char *TAG = "board";

#define W 466
#define PIN_LCD_CS 12
#define PIN_LCD_SCLK 38
#define PIN_LCD_D0 4
#define PIN_LCD_D1 5
#define PIN_LCD_D2 6
#define PIN_LCD_D3 7
#define PIN_I2C_SDA 15
#define PIN_I2C_SCL 14
#define PIN_BOOT 0
#define PIN_I2S_MCLK 42
#define PIN_I2S_BCLK 9
#define PIN_I2S_WS 45
#define PIN_I2S_DIN 10
#define MIC_RATE 16000
#define MIC_MAX_S 15
#define WAV_HEADER 44
static const gpio_num_t LCD_RESETS[] = { 39, 1 };
static const gpio_num_t TOUCH_RESETS[] = { 40, 2 };

// The 1.75's init sequence (Waveshare BSP). Columns 6..471: the glass sits 6
// pixels into the controller's 480-wide memory.
static const co5300_lcd_init_cmd_t INIT_CMDS[] = {
  { 0xFE, (uint8_t[]){ 0x20 }, 1, 0 },
  { 0x19, (uint8_t[]){ 0x10 }, 1, 0 },
  { 0x1C, (uint8_t[]){ 0xA0 }, 1, 0 },
  { 0xFE, (uint8_t[]){ 0x00 }, 1, 0 },
  { 0xC4, (uint8_t[]){ 0x80 }, 1, 0 },
  { 0x3A, (uint8_t[]){ 0x55 }, 1, 0 },
  { 0x35, (uint8_t[]){ 0x00 }, 1, 0 },
  { 0x53, (uint8_t[]){ 0x20 }, 1, 0 },
  { 0x51, (uint8_t[]){ 0xFF }, 1, 0 },
  { 0x63, (uint8_t[]){ 0xFF }, 1, 0 },
  { 0x2A, (uint8_t[]){ 0x00, 0x06, 0x01, 0xD7 }, 4, 0 },
  { 0x2B, (uint8_t[]){ 0x00, 0x00, 0x01, 0xD1 }, 4, 600 },
  { 0x11, NULL, 0, 600 },
  { 0x29, NULL, 0, 0 },
};

static void (*s_button_cb)(void);
static i2c_master_bus_handle_t s_i2c;

// The CO5300 only accepts windows that start on an even pixel and end on an odd one.
static void rounder(lv_area_t *a) {
  a->x1 &= ~1;
  a->y1 &= ~1;
  a->x2 |= 1;
  a->y2 |= 1;
}

static void pulse(const gpio_num_t *pins, int n) {
  for (int i = 0; i < n; i++) {
    gpio_reset_pin(pins[i]);
    gpio_set_direction(pins[i], GPIO_MODE_OUTPUT);
    gpio_set_level(pins[i], 1);
  }
  vTaskDelay(pdMS_TO_TICKS(10));
  for (int i = 0; i < n; i++) gpio_set_level(pins[i], 0);
  vTaskDelay(pdMS_TO_TICKS(20));
  for (int i = 0; i < n; i++) gpio_set_level(pins[i], 1);
  vTaskDelay(pdMS_TO_TICKS(150));
}

static void button_task(void *arg) {
  gpio_config_t io = { .pin_bit_mask = 1ULL << PIN_BOOT, .mode = GPIO_MODE_INPUT, .pull_up_en = 1 };
  gpio_config(&io);
  int last = 1;
  for (;;) {
    int now = gpio_get_level(PIN_BOOT);
    if (last == 1 && now == 0 && s_button_cb) s_button_cb();
    last = now;
    vTaskDelay(pdMS_TO_TICKS(30));
  }
}

void board_on_button(void (*cb)(void)) {
  s_button_cb = cb;
  xTaskCreate(button_task, "button", 2560, NULL, 3, NULL);
}

esp_err_t board_init(void) {
  pulse(LCD_RESETS, 2);
  pulse(TOUCH_RESETS, 2);

  // Screen
  const spi_bus_config_t bus = CO5300_PANEL_BUS_QSPI_CONFIG(PIN_LCD_SCLK, PIN_LCD_D0, PIN_LCD_D1, PIN_LCD_D2, PIN_LCD_D3,
                                                            W * 80 * sizeof(uint16_t));
  ESP_RETURN_ON_ERROR(spi_bus_initialize(SPI2_HOST, &bus, SPI_DMA_CH_AUTO), TAG, "spi bus");
  esp_lcd_panel_io_handle_t io;
  const esp_lcd_panel_io_spi_config_t io_cfg = CO5300_PANEL_IO_QSPI_CONFIG(PIN_LCD_CS, NULL, NULL);
  ESP_RETURN_ON_ERROR(esp_lcd_new_panel_io_spi((esp_lcd_spi_bus_handle_t)SPI2_HOST, &io_cfg, &io), TAG, "panel io");
  co5300_vendor_config_t vendor = { .init_cmds = INIT_CMDS, .init_cmds_size = sizeof INIT_CMDS / sizeof INIT_CMDS[0],
                                    .flags = { .use_qspi_interface = 1 } };
  const esp_lcd_panel_dev_config_t panel_cfg = { .reset_gpio_num = -1, .rgb_ele_order = LCD_RGB_ELEMENT_ORDER_RGB,
                                                 .bits_per_pixel = 16, .vendor_config = &vendor };
  esp_lcd_panel_handle_t panel;
  ESP_RETURN_ON_ERROR(esp_lcd_new_panel_co5300(io, &panel_cfg, &panel), TAG, "panel");
  esp_lcd_panel_reset(panel);
  ESP_RETURN_ON_ERROR(esp_lcd_panel_init(panel), TAG, "panel init");
  esp_lcd_panel_set_gap(panel, 6, 0);
  esp_lcd_panel_disp_on_off(panel, true);

  // LVGL
  const lvgl_port_cfg_t port = ESP_LVGL_PORT_INIT_CONFIG();
  ESP_RETURN_ON_ERROR(lvgl_port_init(&port), TAG, "lvgl");
  const lvgl_port_display_cfg_t disp_cfg = {
    .io_handle = io, .panel_handle = panel, .buffer_size = W * 80, .double_buffer = true,
    .hres = W, .vres = W, .color_format = LV_COLOR_FORMAT_RGB565, .rounder_cb = rounder,
    .flags = { .buff_dma = 1, .swap_bytes = 1 },
  };
  lv_display_t *disp = lvgl_port_add_disp(&disp_cfg);
  if (!disp) return ESP_FAIL;

  // Touch
  const i2c_master_bus_config_t i2c_cfg = { .i2c_port = I2C_NUM_1, .sda_io_num = PIN_I2C_SDA, .scl_io_num = PIN_I2C_SCL,
                                            .clk_source = I2C_CLK_SRC_DEFAULT, .glitch_ignore_cnt = 7,
                                            .flags.enable_internal_pullup = true };
  ESP_RETURN_ON_ERROR(i2c_new_master_bus(&i2c_cfg, &s_i2c), TAG, "i2c");
  if (i2c_master_probe(s_i2c, ESP_LCD_TOUCH_IO_I2C_CST816S_ADDRESS, 100) != ESP_OK) {
    ESP_LOGW(TAG, "no touch chip at 0x15 -- running without touch");
    return ESP_OK;
  }
  esp_lcd_panel_io_handle_t tio;
  esp_lcd_panel_io_i2c_config_t tio_cfg = ESP_LCD_TOUCH_IO_I2C_CST816S_CONFIG();
  tio_cfg.scl_speed_hz = 400000;
  ESP_RETURN_ON_ERROR(esp_lcd_new_panel_io_i2c(s_i2c, &tio_cfg, &tio), TAG, "touch io");
  // The chip only pulses its interrupt on touch down/up, and with an interrupt
  // pin esp_lvgl_port reads only on those pulses, so LVGL never saw the finger
  // move and swipes did nothing. Poll it instead, and keep it awake (0xFE
  // DisAutoSleep) so it answers every read.
  esp_lcd_panel_io_tx_param(tio, 0xFE, (uint8_t[]){ 0x01 }, 1);
  const esp_lcd_touch_config_t tcfg = {
    .x_max = W, .y_max = W, .rst_gpio_num = -1, .int_gpio_num = GPIO_NUM_NC,
    .flags = { .swap_xy = 0, .mirror_x = 1, .mirror_y = 1 },  // as on Waveshare's 1.75
  };
  esp_lcd_touch_handle_t tp;
  ESP_RETURN_ON_ERROR(esp_lcd_touch_new_i2c_cst816s(tio, &tcfg, &tp), TAG, "touch");
  const lvgl_port_touch_cfg_t touch = { .disp = disp, .handle = tp };
  lvgl_port_add_touch(&touch);
  ESP_LOGI(TAG, "screen and touch ready");
  return ESP_OK;
}

// ---- microphone --------------------------------------------------------------
// The ES7210 mic chip shares the touch chip's I2C bus and sends audio over I2S
// (pins and settings as in Waveshare's BSP). A recording goes into one PSRAM
// buffer laid out as a WAV file (16 kHz, 16-bit, mono), ready to upload.

static esp_codec_dev_handle_t s_mic;
static uint8_t *s_wav;
static volatile size_t s_wav_len;
static volatile bool s_recording;
static TaskHandle_t s_mic_task;

static esp_err_t mic_init(void) {
  if (s_mic) return ESP_OK;
  if (!s_i2c) return ESP_ERR_INVALID_STATE;
  i2s_chan_handle_t rx;
  i2s_chan_config_t chan = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0, I2S_ROLE_MASTER);
  ESP_RETURN_ON_ERROR(i2s_new_channel(&chan, NULL, &rx), TAG, "i2s");
  i2s_std_config_t std = {
    .clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(MIC_RATE),
    .slot_cfg = I2S_STD_PHILIP_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_MONO),
    .gpio_cfg = { .mclk = PIN_I2S_MCLK, .bclk = PIN_I2S_BCLK, .ws = PIN_I2S_WS, .dout = I2S_GPIO_UNUSED, .din = PIN_I2S_DIN },
  };
  ESP_RETURN_ON_ERROR(i2s_channel_init_std_mode(rx, &std), TAG, "i2s std");
  ESP_RETURN_ON_ERROR(i2s_channel_enable(rx), TAG, "i2s on");

  audio_codec_i2s_cfg_t i2s_cfg = { .port = I2S_NUM_0, .rx_handle = rx };
  const audio_codec_data_if_t *data_if = audio_codec_new_i2s_data(&i2s_cfg);
  audio_codec_i2c_cfg_t i2c_cfg = { .port = I2C_NUM_1, .addr = ES7210_CODEC_DEFAULT_ADDR, .bus_handle = s_i2c };
  const audio_codec_ctrl_if_t *ctrl_if = audio_codec_new_i2c_ctrl(&i2c_cfg);
  es7210_codec_cfg_t es_cfg = { .ctrl_if = ctrl_if };
  const audio_codec_if_t *es = es7210_codec_new(&es_cfg);
  if (!data_if || !ctrl_if || !es) return ESP_FAIL;
  esp_codec_dev_cfg_t dev_cfg = { .dev_type = ESP_CODEC_DEV_TYPE_IN, .codec_if = es, .data_if = data_if };
  s_mic = esp_codec_dev_new(&dev_cfg);
  if (!s_mic) return ESP_FAIL;
  s_wav = heap_caps_malloc(WAV_HEADER + MIC_RATE * 2 * MIC_MAX_S, MALLOC_CAP_SPIRAM);
  if (!s_wav) return ESP_ERR_NO_MEM;
  ESP_LOGI(TAG, "microphone ready");
  return ESP_OK;
}

static void put32(uint8_t *p, uint32_t v) { p[0] = v; p[1] = v >> 8; p[2] = v >> 16; p[3] = v >> 24; }

static void wav_header(uint8_t *h, uint32_t data) {
  memcpy(h, "RIFF", 4); put32(h + 4, 36 + data); memcpy(h + 8, "WAVEfmt ", 8);
  put32(h + 16, 16); h[20] = 1; h[21] = 0; h[22] = 1; h[23] = 0;  // PCM, mono
  put32(h + 24, MIC_RATE); put32(h + 28, MIC_RATE * 2); h[32] = 2; h[33] = 0; h[34] = 16; h[35] = 0;
  memcpy(h + 36, "data", 4); put32(h + 40, data);
}

static void mic_task(void *arg) {
  esp_codec_dev_sample_info_t fs = { .bits_per_sample = 16, .channel = 1, .sample_rate = MIC_RATE };
  esp_codec_dev_open(s_mic, &fs);
  esp_codec_dev_set_in_gain(s_mic, 30.0);
  const size_t max = MIC_RATE * 2 * MIC_MAX_S, chunk = MIC_RATE / 50 * 2;  // 20 ms
  while (s_recording && s_wav_len + chunk <= max) {
    if (esp_codec_dev_read(s_mic, s_wav + WAV_HEADER + s_wav_len, chunk) == ESP_CODEC_DEV_OK) s_wav_len += chunk;
  }
  esp_codec_dev_close(s_mic);
  s_recording = false;
  s_mic_task = NULL;
  vTaskDelete(NULL);
}

esp_err_t board_mic_start(void) {
  if (s_recording || s_mic_task) return ESP_ERR_INVALID_STATE;
  ESP_RETURN_ON_ERROR(mic_init(), TAG, "mic");
  s_wav_len = 0;
  s_recording = true;
  if (xTaskCreatePinnedToCore(mic_task, "mic", 4096, NULL, 6, &s_mic_task, 1) != pdPASS) {
    s_recording = false;
    return ESP_ERR_NO_MEM;
  }
  return ESP_OK;
}

bool board_mic_recording(void) { return s_recording; }

size_t board_mic_stop(const uint8_t **wav) {
  s_recording = false;
  while (s_mic_task) vTaskDelay(pdMS_TO_TICKS(10));
  if (!s_wav) { *wav = NULL; return 0; }
  wav_header(s_wav, s_wav_len);
  *wav = s_wav;
  return WAV_HEADER + s_wav_len;
}
