// Friend Flower for the round device: joins Wi-Fi, links to a friendflower.app
// account with an on-screen code, then shows Home / Nearby / Chats / Trips /
// Places, refreshed every minute.
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "esp_system.h"
#include "nvs_flash.h"
#include "api.h"
#include "board.h"
#include "net.h"
#include "ui.h"

static bool s_linked, s_have_summary;

static void on_net(net_state_t st, const char *detail) {
  switch (st) {
    case NET_SETUP:
      ui_message(detail ? detail : "Set up Wi-Fi", NULL,
                 "On your phone, join the Wi-Fi\n\"Friend Flower Setup\"\nand pick your home network.");
      break;
    case NET_JOINING: {
      char body[96];
      snprintf(body, sizeof body, "Connecting to\n%s...", detail ? detail : "your Wi-Fi");
      ui_message("Friend Flower", NULL, body);
      break;
    }
    case NET_ONLINE:
      if (s_linked && s_have_summary) ui_hide_message();
      else if (!s_linked) ui_message("Friend Flower", NULL, "Connected. Getting your code...");
      api_refresh();
      break;
    case NET_RECONNECTING:
      if (!s_have_summary) ui_message("Friend Flower", NULL, "Wi-Fi dropped. Reconnecting...");
      break;
  }
}

static void on_api(api_event_t ev, void *data) {
  switch (ev) {
    case API_CODE:
      s_linked = false;
      ui_message("Link your account", (const char *)data, "Go to friendflower.app/device\nand type this code.");
      break;
    case API_LINKED:
      s_linked = true;
      if (!s_have_summary) ui_message("Friend Flower", NULL, "Linked! Loading your flower...");
      break;
    case API_SUMMARY:
      s_have_summary = true;
      ui_summary(data);
      cJSON_Delete(data);
      ui_hide_message();
      break;
    case API_OFFLINE:
      if (!s_have_summary) ui_message("Friend Flower", NULL, "Can't reach friendflower.app.\nTrying again...");
      break;
    case API_UNLINKED:
      s_linked = s_have_summary = false;
      ui_message("Unlinked", NULL, "This device was removed from your account. Getting a new code...");
      break;
  }
}

static void on_action(ui_action_t a) {
  if (a == UI_FORGET_WIFI) net_forget();
  if (a == UI_UNLINK) api_unlink();
  ui_message("Restarting", NULL, "");
  vTaskDelay(pdMS_TO_TICKS(800));
  esp_restart();
}

void app_main(void) {
  esp_err_t err = nvs_flash_init();
  if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
    ESP_ERROR_CHECK(nvs_flash_erase());
    ESP_ERROR_CHECK(nvs_flash_init());
  }
  ESP_ERROR_CHECK(board_init());
  ui_start(on_action);
  ui_message("Friend Flower", NULL, "Starting...");
  board_on_button(ui_home);
  net_start(on_net);
  api_start(on_api);
}
