// One chat, opened from Chats: the friend's photo and the latest messages.
// Hold anywhere for 3 seconds, keep holding and say what you want to tell
// them, then let go: Fo writes the message, and it's only posted if you tap
// Send. Swipe right, tap Close or press BOOT to go back.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "esp_lvgl_port.h"
#include "api.h"
#include "fo.h"
#include "ui_common.h"

enum { IDLE, LISTENING, WRITING, DRAFT, SENDING };

static lv_obj_t *s_view, *s_photo_slot, *s_msgs, *s_hint, *s_draft, *s_draft_text;
static char s_chat[40], s_member[40], s_name[40], s_draft_buf[2001];
static int s_state = IDLE, s_gen;
static uint32_t s_pressed_at;
// What Send posts, copied when it's tapped: the open chat can change before the job runs.
static struct { char chat[40], body[2001]; int gen; } s_send;

static void set_hint(const char *text, lv_color_t color) {
  char buf[300];
  ui_ascii(text, buf, sizeof buf);
  lv_label_set_text(s_hint, buf);
  lv_obj_set_style_text_color(s_hint, color, 0);
}

static void idle_hint(void) { set_hint("Hold 3 s: Fo Concierge messages them", GREY); }

static void bubble(bool mine, const char *sender, const char *body) {
  char b[420];
  ui_ascii(body, b, sizeof b);
  lv_obj_t *wrap = lv_obj_create(s_msgs);
  lv_obj_remove_style_all(wrap);
  lv_obj_set_size(wrap, lv_pct(100), LV_SIZE_CONTENT);
  lv_obj_remove_flag(wrap, LV_OBJ_FLAG_CLICKABLE | LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_add_flag(wrap, LV_OBJ_FLAG_EVENT_BUBBLE);
  lv_obj_t *bub = lv_obj_create(wrap);
  lv_obj_remove_style_all(bub);
  lv_obj_set_size(bub, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
  lv_obj_set_style_max_width(bub, 240, 0);
  lv_obj_set_style_pad_hor(bub, 12, 0);
  lv_obj_set_style_pad_ver(bub, 8, 0);
  lv_obj_set_style_radius(bub, 16, 0);
  lv_obj_set_style_bg_color(bub, mine ? PINK : CARD, 0);
  lv_obj_set_style_bg_opa(bub, LV_OPA_COVER, 0);
  lv_obj_remove_flag(bub, LV_OBJ_FLAG_CLICKABLE | LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_add_flag(bub, LV_OBJ_FLAG_EVENT_BUBBLE);
  lv_obj_align(bub, mine ? LV_ALIGN_RIGHT_MID : LV_ALIGN_LEFT_MID, 0, 0);
  lv_obj_t *l = ui_label(bub, &lv_font_montserrat_14, mine ? BG : lv_color_white(), b);
  lv_obj_set_style_text_align(l, LV_TEXT_ALIGN_LEFT, 0);
  lv_label_set_long_mode(l, LV_LABEL_LONG_WRAP);
  lv_obj_set_width(l, LV_SIZE_CONTENT);
  lv_obj_set_style_max_width(l, 216, 0);
  (void)sender;
}

// ---- loading and sending (on the API job task) -------------------------------

static void load_job(void *arg) {
  int gen = (int)(intptr_t)arg;
  char path[96];
  snprintf(path, sizeof path, "/api/device/chat/%s", s_chat);
  cJSON *j = NULL;
  int st = api_json("GET", path, NULL, 20000, &j);
  lvgl_port_lock(0);
  if (gen == s_gen && s_view && !lv_obj_has_flag(s_view, LV_OBJ_FLAG_HIDDEN)) {
    lv_obj_clean(s_msgs);
    const cJSON *m;
    cJSON_ArrayForEach(m, cJSON_GetObjectItem(j, "messages")) {
      const char *kind = ui_str(m, "kind"), *body = ui_str(m, "body");
      if (!body || !body[0]) continue;
      if (kind && !strcmp(kind, "system")) {
        char b[300];
        ui_ascii(body, b, sizeof b);
        lv_obj_t *l = ui_label(s_msgs, &lv_font_montserrat_14, GREY, b);
        lv_label_set_long_mode(l, LV_LABEL_LONG_WRAP);
        lv_obj_set_width(l, lv_pct(100));
        continue;
      }
      bubble(cJSON_IsTrue(cJSON_GetObjectItem(m, "mine")), ui_str(m, "sender"), body);
    }
    if (st != 200) set_hint("Couldn't load this chat.", GREY);
    else if (!cJSON_IsTrue(cJSON_GetObjectItem(j, "can_post"))) set_hint("You can't post in this chat any more.", GREY);
    lv_obj_update_layout(s_msgs);
    lv_obj_scroll_to_y(s_msgs, LV_COORD_MAX, LV_ANIM_OFF);
  }
  lvgl_port_unlock();
  cJSON_Delete(j);
}

static void send_job(void *arg) {
  int gen = s_send.gen;
  char path[96];
  snprintf(path, sizeof path, "/api/device/chat/%s/send", s_send.chat);
  cJSON *body = cJSON_CreateObject();
  cJSON_AddStringToObject(body, "body", s_send.body);
  char *json = cJSON_PrintUnformatted(body);
  cJSON_Delete(body);
  cJSON *j = NULL;
  int st = json ? api_json("POST", path, json, 20000, &j) : -1;
  free(json);
  cJSON_Delete(j);
  lvgl_port_lock(0);
  if (gen == s_gen) {
    s_state = IDLE;
    lv_obj_add_flag(s_draft, LV_OBJ_FLAG_HIDDEN);
    if (st == 200) { set_hint("Sent!", PINK); api_job(load_job, (void *)(intptr_t)s_gen); api_refresh(); }
    else set_hint("Couldn't send that. Please try again.", GREY);
  }
  lvgl_port_unlock();
}

// ---- Fo ------------------------------------------------------------------------

static void on_fo(fo_event_t ev, const char *text, void *ctx) {
  if ((int)(intptr_t)ctx != s_gen || s_state != WRITING) return;
  switch (ev) {
    case FO_HEARD: {
      char said[300];
      snprintf(said, sizeof said, "You: \"%s\"", text);
      set_hint(said, GREY);
      break;
    }
    case FO_WORKING:
      break;  // keep showing what we heard
    case FO_DONE: {
      s_state = DRAFT;
      // Fo sometimes wraps the message in quotes.
      size_t n = strlen(text);
      if (n >= 2 && text[0] == '"' && text[n - 1] == '"') snprintf(s_draft_buf, sizeof s_draft_buf, "%.*s", (int)n - 2, text + 1);
      else snprintf(s_draft_buf, sizeof s_draft_buf, "%s", text);
      char shown[600];
      ui_ascii(s_draft_buf, shown, sizeof shown);
      lv_label_set_text(s_draft_text, shown);
      lv_obj_remove_flag(s_draft, LV_OBJ_FLAG_HIDDEN);
      set_hint("Send this?", PINK);
      break;
    }
    case FO_FAILED:
      s_state = IDLE;
      set_hint(text[0] ? text : "Fo Concierge couldn't write that. Try again.", GREY);
      break;
  }
}

static void on_hold(lv_event_t *e) {
  lv_event_code_t code = lv_event_get_code(e);
  if (code == LV_EVENT_PRESSED) { s_pressed_at = lv_tick_get(); return; }
  if (code == LV_EVENT_LONG_PRESSED_REPEAT && s_state == IDLE && lv_tick_elaps(s_pressed_at) >= 3000) {
    if (fo_listen()) { s_state = LISTENING; set_hint("Listening... let go when you're done", PINK); }
    else set_hint("Fo Concierge is busy. Try again in a moment.", GREY);
    return;
  }
  if ((code == LV_EVENT_RELEASED || code == LV_EVENT_PRESS_LOST) && s_state == LISTENING) {
    s_state = WRITING;
    set_hint("Fo Concierge is writing...", PINK);
    char q[96];
    snprintf(q, sizeof q, "chat=%s&mode=message", s_chat);
    fo_send(q, on_fo, (void *)(intptr_t)s_gen);
  }
}

static void on_gesture(lv_event_t *e) {
  if (s_state == IDLE && lv_indev_get_gesture_dir(lv_indev_active()) == LV_DIR_RIGHT) chat_close();
}

static void on_send(lv_event_t *e) {
  if (s_state != DRAFT) return;
  s_state = SENDING;
  set_hint("Sending...", PINK);
  snprintf(s_send.chat, sizeof s_send.chat, "%s", s_chat);
  snprintf(s_send.body, sizeof s_send.body, "%s", s_draft_buf);
  s_send.gen = s_gen;
  if (!api_job(send_job, NULL)) { s_state = DRAFT; set_hint("Busy. Tap Send again.", GREY); }
}

static void on_cancel(lv_event_t *e) {
  if (s_state != DRAFT) return;
  s_state = IDLE;
  lv_obj_add_flag(s_draft, LV_OBJ_FLAG_HIDDEN);
  idle_hint();
}

static void on_close(lv_event_t *e) { chat_close(); }

// ---- view ----------------------------------------------------------------------

static lv_obj_t *pill(lv_obj_t *parent, const char *text, bool primary, lv_event_cb_t cb) {
  lv_obj_t *b = lv_button_create(parent);
  lv_obj_set_size(b, 120, 48);
  lv_obj_set_style_radius(b, 16, 0);
  lv_obj_set_style_bg_color(b, primary ? PINK : CARD, 0);
  lv_obj_set_style_border_color(b, FAINT, 0);
  lv_obj_set_style_border_width(b, primary ? 0 : 2, 0);
  lv_obj_set_style_shadow_width(b, 0, 0);
  lv_obj_t *l = ui_label(b, &lv_font_montserrat_20, primary ? BG : lv_color_white(), text);
  lv_obj_center(l);
  lv_obj_add_event_cb(b, cb, LV_EVENT_CLICKED, NULL);
  return b;
}

static void build(void) {
  s_view = ui_round_layer();
  lv_obj_add_event_cb(s_view, on_hold, LV_EVENT_PRESSED, NULL);
  lv_obj_add_event_cb(s_view, on_hold, LV_EVENT_LONG_PRESSED_REPEAT, NULL);
  lv_obj_add_event_cb(s_view, on_hold, LV_EVENT_RELEASED, NULL);
  lv_obj_add_event_cb(s_view, on_hold, LV_EVENT_PRESS_LOST, NULL);
  lv_obj_add_event_cb(s_view, on_gesture, LV_EVENT_GESTURE, NULL);

  s_photo_slot = lv_obj_create(s_view);
  lv_obj_remove_style_all(s_photo_slot);
  lv_obj_set_size(s_photo_slot, 84, 84);
  lv_obj_align(s_photo_slot, LV_ALIGN_TOP_MID, 0, 22);
  lv_obj_remove_flag(s_photo_slot, LV_OBJ_FLAG_CLICKABLE | LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_add_flag(s_photo_slot, LV_OBJ_FLAG_EVENT_BUBBLE);

  s_msgs = lv_obj_create(s_view);
  lv_obj_remove_style_all(s_msgs);
  lv_obj_set_size(s_msgs, 330, 238);
  lv_obj_align(s_msgs, LV_ALIGN_TOP_MID, 0, 112);
  lv_obj_set_flex_flow(s_msgs, LV_FLEX_FLOW_COLUMN);
  lv_obj_set_style_pad_row(s_msgs, 8, 0);
  lv_obj_set_scroll_dir(s_msgs, LV_DIR_VER);
  lv_obj_set_scrollbar_mode(s_msgs, LV_SCROLLBAR_MODE_OFF);
  lv_obj_add_flag(s_msgs, LV_OBJ_FLAG_EVENT_BUBBLE);
  lv_obj_add_flag(s_msgs, LV_OBJ_FLAG_SCROLL_ELASTIC);

  s_hint = ui_label(s_view, &lv_font_montserrat_14, GREY, "");
  lv_label_set_long_mode(s_hint, LV_LABEL_LONG_DOT);
  lv_obj_set_size(s_hint, 300, 36);
  lv_obj_align(s_hint, LV_ALIGN_TOP_MID, 0, 358);
  lv_obj_t *close = ui_label(s_view, &lv_font_montserrat_20, PINK, "Close");
  lv_obj_add_flag(close, LV_OBJ_FLAG_CLICKABLE);
  lv_obj_set_ext_click_area(close, 14);
  lv_obj_align(close, LV_ALIGN_TOP_MID, 0, 400);
  lv_obj_add_event_cb(close, on_close, LV_EVENT_CLICKED, NULL);

  // Fo's draft, over the messages, with Send / Cancel.
  s_draft = lv_obj_create(s_view);
  lv_obj_remove_style_all(s_draft);
  lv_obj_set_size(s_draft, 340, 240);
  lv_obj_align(s_draft, LV_ALIGN_TOP_MID, 0, 110);
  lv_obj_set_style_radius(s_draft, 24, 0);
  lv_obj_set_style_bg_color(s_draft, CARD, 0);
  lv_obj_set_style_bg_opa(s_draft, LV_OPA_COVER, 0);
  lv_obj_set_style_border_color(s_draft, PINK, 0);
  lv_obj_set_style_border_width(s_draft, 2, 0);
  lv_obj_remove_flag(s_draft, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_t *who = ui_label(s_draft, &lv_font_montserrat_14, PINK, "Fo Concierge wrote:");
  lv_obj_align(who, LV_ALIGN_TOP_MID, 0, 14);
  lv_obj_t *box = lv_obj_create(s_draft);
  lv_obj_remove_style_all(box);
  lv_obj_set_size(box, 300, 130);
  lv_obj_align(box, LV_ALIGN_TOP_MID, 0, 38);
  lv_obj_set_scroll_dir(box, LV_DIR_VER);
  lv_obj_set_scrollbar_mode(box, LV_SCROLLBAR_MODE_OFF);
  s_draft_text = ui_label(box, &lv_font_montserrat_20, lv_color_white(), "");
  lv_label_set_long_mode(s_draft_text, LV_LABEL_LONG_WRAP);
  lv_obj_set_width(s_draft_text, 300);
  lv_obj_t *send = pill(s_draft, "Send", true, on_send);
  lv_obj_align(send, LV_ALIGN_BOTTOM_MID, 66, -14);
  lv_obj_t *cancel = pill(s_draft, "Cancel", false, on_cancel);
  lv_obj_align(cancel, LV_ALIGN_BOTTOM_MID, -66, -14);
  lv_obj_add_flag(s_draft, LV_OBJ_FLAG_HIDDEN);
  lv_obj_add_flag(s_view, LV_OBJ_FLAG_HIDDEN);
}

void chat_open(const char *chat_id, const char *member_id, const char *name) {
  if (!s_view) build();
  snprintf(s_chat, sizeof s_chat, "%s", chat_id);
  snprintf(s_member, sizeof s_member, "%s", member_id ? member_id : "");
  snprintf(s_name, sizeof s_name, "%s", name ? name : "");
  s_gen++;
  s_state = IDLE;
  lv_obj_clean(s_photo_slot);
  lv_obj_t *photo = ui_avatar(s_photo_slot, s_member[0] ? s_member : NULL, 84, true, s_name);
  lv_obj_center(photo);
  lv_obj_clean(s_msgs);
  lv_obj_t *wait = ui_label(s_msgs, &lv_font_montserrat_14, GREY, "Loading...");
  lv_obj_set_width(wait, lv_pct(100));
  lv_obj_add_flag(s_draft, LV_OBJ_FLAG_HIDDEN);
  idle_hint();
  lv_obj_remove_flag(s_view, LV_OBJ_FLAG_HIDDEN);
  if (!api_job(load_job, (void *)(intptr_t)s_gen)) set_hint("Busy. Close and open the chat again.", GREY);
}

void chat_close(void) {
  if (!s_view || lv_obj_has_flag(s_view, LV_OBJ_FLAG_HIDDEN)) return;
  s_gen++;
  if (s_state == LISTENING || s_state == WRITING) fo_cancel();
  s_state = IDLE;
  lv_obj_add_flag(s_view, LV_OBJ_FLAG_HIDDEN);
}
