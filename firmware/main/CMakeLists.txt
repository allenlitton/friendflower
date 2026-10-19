idf_component_register(
  SRCS main.c board.c net.c api.c ui.c media.c fo.c chat.c talk.c img_petal.c img_face.c
  INCLUDE_DIRS .
  REQUIRES nvs_flash esp_wifi esp_netif esp_event esp_http_client esp_http_server esp-tls json lwip
           esp_lcd driver esp_driver_gpio esp_driver_spi esp_driver_i2c esp_driver_i2s mbedtls
)

# idf.py build -DFF_API_BASE=http://<your-mac>:3000 points the device at a local server for testing.
if(DEFINED FF_API_BASE)
  target_compile_definitions(${COMPONENT_LIB} PRIVATE FF_API_BASE="${FF_API_BASE}")
endif()
