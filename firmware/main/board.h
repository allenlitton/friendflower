#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "esp_err.h"

// The round device's hardware: CO5300 466x466 AMOLED over QSPI, CST9217 /
// CST816S touch, BOOT button, ES7210 microphone. Pins are in board.c.
esp_err_t board_init(void);               // screen + touch + LVGL
void board_on_button(void (*cb)(void));   // BOOT button pressed

// Microphone: record up to 15 s, then take it as a WAV file (16 kHz mono).
// The buffer belongs to the board and is reused by the next recording.
esp_err_t board_mic_start(void);
bool board_mic_recording(void);           // false once stopped or after 15 s
size_t board_mic_stop(const uint8_t **wav);
