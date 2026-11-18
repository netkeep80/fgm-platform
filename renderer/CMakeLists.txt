cmake_minimum_required(VERSION 3.24)
project(fgm_boot LANGUAGES CXX)

if(NOT TARGET fgm::cpu)
  add_subdirectory("${CMAKE_CURRENT_SOURCE_DIR}/../core" "${CMAKE_CURRENT_BINARY_DIR}/core")
endif()
if(NOT TARGET fgm::raster)
  add_subdirectory("${CMAKE_CURRENT_SOURCE_DIR}/../raster" "${CMAKE_CURRENT_BINARY_DIR}/raster")
endif()

include(CTest)
option(FGMV_BUILD_TESTS "Проверять native scene и camera Renderer" ON)
option(FGMV_BUILD_GPU_DEMO "Собирать native WebGPU demo; требуется WGPU_ROOT" OFF)

set(BOOT_SIZE 128)
configure_file(src/scene-size.hpp.in generated/scene-size.hpp @ONLY)
add_library(boot_scene STATIC src/scene.cpp src/v03-camera.cpp src/v03-map-camera.cpp)
add_library(fgm::renderer ALIAS boot_scene)
target_compile_features(boot_scene PUBLIC cxx_std_20)
target_include_directories(boot_scene PUBLIC src "${CMAKE_CURRENT_BINARY_DIR}/generated")
target_link_libraries(boot_scene PRIVATE fgm::cpu)

if(EMSCRIPTEN)
  add_executable(fgm_scene src/wasm.cpp src/wasm-camera.cpp)
  target_link_libraries(fgm_scene PRIVATE boot_scene)
  # Исключения обрабатываются внутри границы WASM.
  target_compile_options(fgm_cpu PRIVATE -fexceptions)
  target_compile_options(boot_scene PRIVATE -fexceptions)
  target_compile_options(fgm_scene PRIVATE -fexceptions)
  target_link_options(fgm_scene PRIVATE -fexceptions --no-entry
    "-sMODULARIZE=1" "-sEXPORT_ES6=1" "-sENVIRONMENT=web"
    "-sEXPORTED_RUNTIME_METHODS=['HEAPU8']"
    "-sEXPORTED_FUNCTIONS=['_malloc','_free','_fgm_sample_scene','_fgm_scene_size','_fgm_camera_reset','_fgm_camera_turn','_fgm_camera_zoom','_fgm_camera_project','_fgm_camera_pick']"
    "-sALLOW_MEMORY_GROWTH=1")
  set_target_properties(fgm_scene PROPERTIES SUFFIX ".mjs"
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}/../web")
elseif(FGMV_BUILD_GPU_DEMO)
  set(WGPU_ROOT "" CACHE PATH "Распакованный архив wgpu-native v29.0.1.1")
  find_path(WGPU_INCLUDE webgpu/wgpu.h PATHS "${WGPU_ROOT}/include" REQUIRED NO_DEFAULT_PATH)
  if(WIN32)
    find_file(WGPU_LIBRARY NAMES wgpu_native.dll.lib PATHS "${WGPU_ROOT}/lib" REQUIRED NO_DEFAULT_PATH)
  else()
    find_library(WGPU_LIBRARY NAMES wgpu_native PATHS "${WGPU_ROOT}/lib" REQUIRED NO_DEFAULT_PATH)
  endif()
  add_executable(fgm_boot src/native.cpp)
  target_include_directories(fgm_boot PRIVATE "${WGPU_INCLUDE}")
  target_link_libraries(fgm_boot PRIVATE boot_scene "${WGPU_LIBRARY}")
  if(WIN32)
    add_custom_command(TARGET fgm_boot POST_BUILD COMMAND "${CMAKE_COMMAND}" -E copy_if_different
      "${WGPU_ROOT}/lib/wgpu_native.dll" "$<TARGET_FILE_DIR:fgm_boot>")
  endif()
endif()

if(BUILD_TESTING AND FGMV_BUILD_TESTS AND NOT EMSCRIPTEN)
  find_program(FGMV_NODE_EXECUTABLE NAMES node REQUIRED)
  add_executable(fgm_camera_test tests/v03-camera.test.cpp)
  target_link_libraries(fgm_camera_test PRIVATE fgm::renderer)
  add_executable(fgm_map_camera_test tests/v03-map-camera.test.cpp)
  target_link_libraries(fgm_map_camera_test PRIVATE fgm::renderer)
  add_executable(fgm_scene_test tests/scene.test.cpp)
  target_link_libraries(fgm_scene_test PRIVATE fgm::renderer)
  add_test(NAME renderer-camera COMMAND "${FGMV_NODE_EXECUTABLE}"
    "${CMAKE_CURRENT_SOURCE_DIR}/scripts/test-v03.mjs" "$<TARGET_FILE:fgm_camera_test>")
  add_test(NAME renderer-map-camera COMMAND "${FGMV_NODE_EXECUTABLE}"
    "${CMAKE_CURRENT_SOURCE_DIR}/scripts/test-v03-map.mjs" "$<TARGET_FILE:fgm_map_camera_test>")
  set_tests_properties(renderer-camera renderer-map-camera PROPERTIES
    WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}")
  add_test(NAME renderer-scene COMMAND fgm_scene_test "${CMAKE_CURRENT_SOURCE_DIR}/web/sphere.fgm.json")
endif()
