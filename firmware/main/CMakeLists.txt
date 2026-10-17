idf_component_register(
  SRCS main.c board.c net.c api.c ui.c img_petal.c img_face.c
  INCLUDE_DIRS .
  REQUIRES nvs_flash esp_wifi esp_netif esp_event esp_http_client esp_http_server esp-tls json lwip
           esp_lcd driver esp_driver_gpio esp_driver_spi esp_driver_i2c mbedtls
)
