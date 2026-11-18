cmake_minimum_required(VERSION 3.24)

# Одна существующая CPU RVI реализация для R07 и Renderer, без GPU/CLI зависимостей.
add_library(fgm_raster STATIC rvi-v02.cpp)
add_library(fgm::raster ALIAS fgm_raster)
target_compile_features(fgm_raster PUBLIC cxx_std_20)
target_include_directories(fgm_raster PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}")
set_target_properties(fgm_raster PROPERTIES CXX_EXTENSIONS OFF)

if(BUILD_TESTING AND TARGET fgm::cpu)
  add_executable(fgm_rvi_test tests/rvi-v02.test.cpp)
  target_link_libraries(fgm_rvi_test PRIVATE fgm::raster)
  add_executable(fgm_rvi_c05_test tests/v02-c05.test.cpp)
  target_link_libraries(fgm_rvi_c05_test PRIVATE fgm::raster fgm::cpu nlohmann_json::nlohmann_json)
  find_program(FGM_RASTER_NODE_EXECUTABLE NAMES node REQUIRED)
  add_test(NAME raster-rvi-oracle COMMAND "${FGM_RASTER_NODE_EXECUTABLE}"
    "${CMAKE_CURRENT_SOURCE_DIR}/scripts/test-v02.mjs" "$<TARGET_FILE:fgm_rvi_test>")
  set_tests_properties(raster-rvi-oracle PROPERTIES WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}")
  add_test(NAME raster-c05-parity COMMAND fgm_rvi_c05_test
    "${CMAKE_CURRENT_SOURCE_DIR}/tests/fixtures/v02-scenes.txt")
endif()
