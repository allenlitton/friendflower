// Tap to talk to Fo, from any page. The Fo button sits above the page dots.
// Tap it and speak; tap again (or stop after 15 s) to send. The card shows
// what Fo heard, Fo's progress, then its reply. Tap the reply to close.
// The page you asked from goes along, so Fo knows to help with places or trips.
#include <stdio.h>
#include <string.h>
#include "fo.h"
#include "ui_common.h"

LV_IMAGE_DECLARE(img_face);

enum { IDLE, LISTENING, WAITING, ANSWERED };

static lv_obj_t *s_card, *s_ring, *s_status, *s_heard, *s_reply_box, *s_reply;
static lv_timer_t *s_timer;
static const char *(*s_page_query)(void);
static int s_state = IDLE;

static void set_text(lv_obj_t *l, const char *text) {
  char buf[1200];
  ui_ascii(text, buf, sizeof buf);
  lv_label_set_text(l, buf);
}

static void pulse(void *ring, int32_t v) {
  lv_obj_set_style_border_opa(ring, v, 0);
  lv_obj_set_size(ring, 92 + v / 16, 92 + v / 16);
  lv_obj_align(ring, LV_ALIGN_TOP_MID, 0, 40 - v / 32);
}

static void ring_on(bool on) {
  lv_anim_delete(s_ring, pulse);
  if (!on) { lv_obj_add_flag(s_ring, LV_OBJ_FLAG_HIDDEN); return; }
  lv_obj_remove_flag(s_ring, LV_OBJ_FLAG_HIDDEN);
  lv_anim_t a;
  lv_anim_init(&a);
  lv_anim_set_var(&a, s_ring);
  lv_anim_set_exec_cb(&a, pulse);
  lv_anim_set_values(&a, 60, 255);
  lv_anim_set_duration(&a, 700);
  lv_anim_set_playback_duration(&a, 700);
  lv_anim_set_repeat_count(&a, LV_ANIM_REPEAT_INFINITE);
  lv_anim_start(&a);
}

static void on_fo(fo_event_t ev, const char *text, void *ctx) {
  if (!s_card || lv_obj_has_flag(s_card, LV_OBJ_FLAG_HIDDEN)) return;
  switch (ev) {
    case FO_HEARD: {
      char said[600];
      snprintf(said, sizeof said, "\"%s\"", text);
      set_text(s_heard, said);
      break;
    }
    case FO_WORKING:
      set_text(s_status, text[0] ? text : "Fo is on it...");
      break;
    case FO_DONE:
    case FO_FAILED:
      s_state = ANSWERED;
      ring_on(false);
      lv_label_set_text(s_status, ev == FO_DONE ? "Fo" : "Hmm");
      set_text(s_reply, text[0] ? text : "Done.");
      lv_obj_set_style_text_color(s_reply, ev == FO_DONE ? lv_color_white() : GREY, 0);
      break;
  }
}

static void send_now(void) {
  s_state = WAITING;
  lv_label_set_text(s_status, "Sending to Fo...");
  fo_send(s_page_query ? s_page_query() : "page=general", on_fo, NULL);
}

// Sends by itself when the 15 s recording limit is reached.
static void on_tick(lv_timer_t *t) {
  if (s_state == LISTENING && !fo_listening()) send_now();
}

void talk_close(void) {
  if (!s_card) return;
  fo_cancel();
  ring_on(false);
  s_state = IDLE;
  lv_obj_add_flag(s_card, LV_OBJ_FLAG_HIDDEN);
}

static void on_card_tap(lv_event_t *e) {
  if (s_state == LISTENING) send_now();
  else talk_close();  // while waiting too: Fo's answer still lands in your Fo thread on the site
}

static void on_button(lv_event_t *e) {
  lv_label_set_text(s_heard, "");
  lv_label_set_text(s_reply, "");
  lv_obj_remove_flag(s_card, LV_OBJ_FLAG_HIDDEN);
  lv_obj_scroll_to_y(s_reply_box, 0, LV_ANIM_OFF);
  if (fo_listen()) {
    s_state = LISTENING;
    lv_label_set_text(s_status, "Listening...");
    lv_label_set_text(s_reply, "Ask Fo to book a table, find a place or message a friend. Tap when you're done.");
    lv_obj_set_style_text_color(s_reply, GREY, 0);
    ring_on(true);
  } else {
    s_state = ANSWERED;
    lv_label_set_text(s_status, "Hmm");
    lv_label_set_text(s_reply, "Fo is still busy with your last request, or the mic isn't ready. Try again in a moment.");
    lv_obj_set_style_text_color(s_reply, GREY, 0);
  }
}

void talk_start(lv_obj_t *screen, const char *(*page_query)(void)) {
  s_page_query = page_query;

  lv_obj_t *b = lv_button_create(screen);
  lv_obj_remove_style_all(b);
  lv_obj_set_size(b, 52, 52);
  lv_obj_align(b, LV_ALIGN_BOTTOM_MID, 0, -42);
  lv_obj_set_style_radius(b, LV_RADIUS_CIRCLE, 0);
  lv_obj_set_style_bg_color(b, CARD, 0);
  lv_obj_set_style_bg_opa(b, LV_OPA_COVER, 0);
  lv_obj_set_style_border_color(b, PINK, 0);
  lv_obj_set_style_border_width(b, 2, 0);
  lv_obj_set_ext_click_area(b, 10);
  lv_obj_t *face = lv_image_create(b);
  lv_image_set_src(face, &img_face);
  lv_image_set_scale(face, 108);  // 112 px -> about 47
  lv_obj_center(face);
  lv_obj_add_event_cb(b, on_button, LV_EVENT_CLICKED, NULL);

  s_card = ui_round_layer();
  lv_obj_add_event_cb(s_card, on_card_tap, LV_EVENT_CLICKED, NULL);
  s_ring = lv_obj_create(s_card);
  lv_obj_remove_style_all(s_ring);
  lv_obj_set_style_radius(s_ring, LV_RADIUS_CIRCLE, 0);
  lv_obj_set_style_border_color(s_ring, PINK, 0);
  lv_obj_set_style_border_width(s_ring, 4, 0);
  lv_obj_remove_flag(s_ring, LV_OBJ_FLAG_CLICKABLE);
  lv_obj_add_flag(s_ring, LV_OBJ_FLAG_HIDDEN);
  lv_obj_t *big = lv_image_create(s_card);
  lv_image_set_src(big, &img_face);
  lv_image_set_scale(big, 192);  // about 84 px
  lv_obj_align(big, LV_ALIGN_TOP_MID, 0, 44);
  lv_obj_remove_flag(big, LV_OBJ_FLAG_CLICKABLE);

  s_status = ui_label(s_card, &lv_font_montserrat_28, PINK, "");
  lv_obj_align(s_status, LV_ALIGN_TOP_MID, 0, 144);
  lv_label_set_long_mode(s_status, LV_LABEL_LONG_DOT);
  lv_obj_set_width(s_status, 340);
  s_heard = ui_label(s_card, &lv_font_montserrat_14, GREY, "");
  lv_label_set_long_mode(s_heard, LV_LABEL_LONG_DOT);
  lv_obj_set_size(s_heard, 330, 36);
  lv_obj_align(s_heard, LV_ALIGN_TOP_MID, 0, 184);

  // Fo's replies can be long: they scroll.
  s_reply_box = lv_obj_create(s_card);
  lv_obj_remove_style_all(s_reply_box);
  lv_obj_set_size(s_reply_box, 340, 200);
  lv_obj_align(s_reply_box, LV_ALIGN_TOP_MID, 0, 226);
  lv_obj_set_scroll_dir(s_reply_box, LV_DIR_VER);
  lv_obj_set_scrollbar_mode(s_reply_box, LV_SCROLLBAR_MODE_OFF);
  lv_obj_set_style_pad_bottom(s_reply_box, 60, 0);
  lv_obj_add_flag(s_reply_box, LV_OBJ_FLAG_EVENT_BUBBLE);
  s_reply = ui_label(s_reply_box, &lv_font_montserrat_20, lv_color_white(), "");
  lv_label_set_long_mode(s_reply, LV_LABEL_LONG_WRAP);
  lv_obj_set_width(s_reply, 320);
  lv_obj_align(s_reply, LV_ALIGN_TOP_MID, 0, 0);
  lv_obj_add_flag(s_reply, LV_OBJ_FLAG_EVENT_BUBBLE);
  lv_obj_add_flag(s_card, LV_OBJ_FLAG_HIDDEN);

  s_timer = lv_timer_create(on_tick, 250, NULL);
}
