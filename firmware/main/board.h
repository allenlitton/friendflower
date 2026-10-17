#pragma once
#include "esp_err.h"

// The round device's hardware: CO5300 466x466 AMOLED over QSPI, CST9217 /
// CST816S touch, BOOT button. Pins are in board.c.
esp_err_t board_init(void);               // screen + touch + LVGL
void board_on_button(void (*cb)(void));   // BOOT button pressed
