#pragma once
#include "cJSON.h"

typedef enum { UI_FORGET_WIFI, UI_UNLINK, UI_BACK } ui_action_t;
typedef void (*ui_action_cb_t)(ui_action_t action);

void ui_start(ui_action_cb_t on_action);  // after the display is up
void ui_summary(const cJSON *summary);    // fill every page from /api/device/summary
void ui_message(const char *title, const char *code, const char *body);  // full-screen notice
void ui_hide_message(void);
void ui_home(void);                       // back to Home (the BOOT button)
