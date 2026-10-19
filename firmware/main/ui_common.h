#pragma once
// Shared by the screens (ui.c, chat.c, talk.c). Call with LVGL locked.
#include <stdbool.h>
#include <stddef.h>
#include "cJSON.h"
#include "lvgl.h"

#define W 466
#define PINK lv_color_hex(0xe6a8bd)
#define GREY lv_color_hex(0x9a918c)
#define FAINT lv_color_hex(0x3a352e)
#define BG lv_color_hex(0x0d0c0b)
#define CARD lv_color_hex(0x1a1816)

lv_obj_t *ui_label(lv_obj_t *parent, const lv_font_t *font, lv_color_t color, const char *text);
void ui_ascii(const char *in, char *out, size_t len);  // the fonts are ASCII only
const char *ui_str(const cJSON *o, const char *key);
lv_obj_t *ui_round_layer(void);                        // full-screen layer above the pages
// A round photo of a member (`halo`: with petals behind), filled in when it
// arrives. Without a photo it shows `name`'s initial on their gradient.
lv_obj_t *ui_avatar(lv_obj_t *parent, const char *id, int size, bool halo, const char *name);
void ui_media_ready(void);                             // a photo or the map arrived

// chat.c
void chat_open(const char *chat_id, const char *member_id, const char *name);
void chat_close(void);
// talk.c
void talk_start(lv_obj_t *screen, const char *(*page_query)(void));
void talk_close(void);
