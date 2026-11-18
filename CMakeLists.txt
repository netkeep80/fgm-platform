cmake_minimum_required(VERSION 3.24)
project(fgm_platform LANGUAGES CXX)

include(CTest)
if(MSVC)
  add_compile_options(/utf-8)
endif()

# Единственный локальный владелец CPU-семантики; внешняя копия Core не загружается.
add_subdirectory(core)

if(BUILD_TESTING)
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
