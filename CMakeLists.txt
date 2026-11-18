cmake_minimum_required(VERSION 3.24)
project(fgm_platform LANGUAGES CXX)

include(CTest)
if(MSVC)
  add_compile_options(/utf-8)
endif()

# Единственный локальный владелец CPU-семантики; внешняя копия Core не загружается.
add_subdirectory(core)
add_subdirectory(raster)
add_subdirectory(regenerator)
add_subdirectory(renderer)

if(BUILD_TESTING AND NOT EMSCRIPTEN)
  find_program(FGMP_NODE_EXECUTABLE NAMES node REQUIRED)
  add_executable(fgmp_core_sample tests/core/sample.cpp)
  target_link_libraries(fgmp_core_sample PRIVATE fgm::cpu)
  set_target_properties(fgmp_core_sample PROPERTIES CXX_EXTENSIONS OFF)
  add_test(NAME core-c05-parity COMMAND "${FGMP_NODE_EXECUTABLE}"
    "${CMAKE_CURRENT_SOURCE_DIR}/tests/core-parity.test.mjs" "$<TARGET_FILE:fgmp_core_sample>")
  add_test(NAME core-external-consumer COMMAND "${FGMP_NODE_EXECUTABLE}"
    "${CMAKE_CURRENT_SOURCE_DIR}/scripts/check-core-consumer.mjs" "${CMAKE_COMMAND}")
  set_tests_properties(core-c05-parity PROPERTIES TIMEOUT 60)
  set_tests_properties(core-external-consumer PROPERTIES TIMEOUT 300)
endif()

if(EMSCRIPTEN)
  find_package(Git REQUIRED)
  execute_process(COMMAND "${GIT_EXECUTABLE}" -C "${CMAKE_CURRENT_SOURCE_DIR}" rev-parse HEAD
    OUTPUT_VARIABLE FGMP_BUILD_REVISION OUTPUT_STRIP_TRAILING_WHITESPACE COMMAND_ERROR_IS_FATAL ANY)
  execute_process(COMMAND "${GIT_EXECUTABLE}" -C "${CMAKE_CURRENT_SOURCE_DIR}" rev-parse "HEAD^{tree}"
    OUTPUT_VARIABLE FGMP_BUILD_TREE OUTPUT_STRIP_TRAILING_WHITESPACE COMMAND_ERROR_IS_FATAL ANY)
  file(WRITE "${CMAKE_BINARY_DIR}/platform-build.json"
    "{\"schema\":\"fgmp-build/1\",\"revision\":\"${FGMP_BUILD_REVISION}\",\"tree\":\"${FGMP_BUILD_TREE}\"}\n")
endif()
