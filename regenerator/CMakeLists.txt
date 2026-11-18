cmake_minimum_required(VERSION 3.24)
project(fgm_regenerator VERSION 0.1.0 LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
include(CTest)
# Семантический revision идентифицирует неизменённый контракт, не сетевой source pin.
set(FGMR_CORE_REVISION ba91a5e96d9f4f9580c9b2e9a9460b97acb7f01b)
if(NOT TARGET fgm::cpu)
  add_subdirectory("${CMAKE_CURRENT_SOURCE_DIR}/../core" "${CMAKE_CURRENT_BINARY_DIR}/core")
endif()
if(NOT TARGET fgm::raster)
  add_subdirectory("${CMAKE_CURRENT_SOURCE_DIR}/../raster" "${CMAKE_CURRENT_BINARY_DIR}/raster")
endif()
option(FGMR_BUILD_TESTS "Собирать предметные тесты Regenerator" "${BUILD_TESTING}")

add_library(fgmr-occupancy STATIC src/model-occupancy.cpp)
target_link_libraries(fgmr-occupancy PUBLIC fgm::cpu)
add_library(fgmr-terrain STATIC src/map-facts.cpp src/loft-voxels.cpp src/sprite-facts.cpp)
add_library(fgmr-projection src/projection.cpp)
target_include_directories(fgmr-projection PUBLIC src)
target_include_directories(fgmr-terrain PUBLIC src)
add_library(fgmr-whole-sample STATIC src/whole-sampling.cpp)
target_include_directories(fgmr-whole-sample PUBLIC src)
target_link_libraries(fgmr-whole-sample PUBLIC fgm::cpu PRIVATE nlohmann_json::nlohmann_json)
add_library(fgmr-sha256 STATIC src/sha256.cpp)
add_library(fgmr-whole-build STATIC src/whole-build.cpp)
target_include_directories(fgmr-whole-build PUBLIC src)
target_link_libraries(fgmr-whole-build PRIVATE fgmr-whole-sample fgmr-sha256 nlohmann_json::nlohmann_json)
add_library(fgmr-studio-run STATIC src/studio-run.cpp src/studio-cell.cpp src/studio-catalog.cpp)
target_link_libraries(fgmr-studio-run PUBLIC fgmr-occupancy PRIVATE fgmr-terrain fgmr-projection fgmr-whole-sample fgmr-whole-build fgmr-sha256 nlohmann_json::nlohmann_json)
target_compile_definitions(fgmr-studio-run PRIVATE FGMR_CORE_REVISION="${FGMR_CORE_REVISION}")
foreach(target IN ITEMS fgmr-occupancy fgmr-terrain fgmr-projection fgmr-whole-sample fgmr-sha256 fgmr-whole-build fgmr-studio-run)
  if(MSVC)
    target_compile_options(${target} PRIVATE /W4 /utf-8 /WX)
  else()
    target_compile_options(${target} PRIVATE -Wall -Wextra -Wpedantic -Werror)
  endif()
endforeach()

if(EMSCRIPTEN)
  add_executable(fgmr-studio src/studio-wasm.cpp)
  target_link_libraries(fgmr-studio PRIVATE fgmr-studio-run)
  foreach(target IN ITEMS fgm_cpu fgmr-occupancy fgmr-terrain fgmr-projection fgmr-whole-sample fgmr-sha256 fgmr-whole-build fgmr-studio-run fgmr-studio)
    target_compile_options(${target} PRIVATE -fexceptions)
  endforeach()
  target_link_options(fgmr-studio PRIVATE --no-entry -fexceptions
    "-sMODULARIZE=1" "-sEXPORT_ES6=1" "-sENVIRONMENT=web,worker,node"
    "-sEXPORTED_RUNTIME_METHODS=['HEAPU8']"
    "-sEXPORTED_FUNCTIONS=['_malloc','_free','_fgmr_studio_call']"
    "-sALLOW_MEMORY_GROWTH=1" "-sINITIAL_MEMORY=16777216" "-sMAXIMUM_MEMORY=33554432"
    "-sABORTING_MALLOC=0")
  set_target_properties(fgmr-studio PROPERTIES SUFFIX ".mjs")
  configure_file(studio/worker.mjs worker.mjs COPYONLY)
  return()
endif()

add_executable(fgmr-studio-native src/studio-native.cpp)
target_link_libraries(fgmr-studio-native PRIVATE fgmr-studio-run)

add_executable(fgm-regenerator src/main.cpp src/local-files.cpp)
if(MSVC)
  target_compile_options(fgm-regenerator PRIVATE /W4 /utf-8)
else()
  target_compile_options(fgm-regenerator PRIVATE -Wall -Wextra -Wpedantic)
endif()
if(MINGW)
  target_link_options(fgm-regenerator PRIVATE -municode)
endif()


add_executable(fgmr-r02 src/facts-main.cpp)
target_link_libraries(fgmr-r02 PRIVATE fgmr-terrain)
if(MSVC)
  target_compile_options(fgmr-r02 PRIVATE /W4 /utf-8 /WX)
else()
  target_compile_options(fgmr-r02 PRIVATE -Wall -Wextra -Wpedantic -Werror)
endif()

add_executable(fgmr-r03 src/loft-main.cpp)
target_link_libraries(fgmr-r03 PRIVATE fgmr-terrain)
if(MSVC)
  target_compile_options(fgmr-r03 PRIVATE /W4 /utf-8 /WX)
else()
  target_compile_options(fgmr-r03 PRIVATE -Wall -Wextra -Wpedantic -Werror)
endif()

add_executable(fgmr-r04 src/sprite-main.cpp)
target_link_libraries(fgmr-r04 PRIVATE fgmr-terrain)
if(MSVC)
  target_compile_options(fgmr-r04 PRIVATE /W4 /utf-8 /WX)
else()
  target_compile_options(fgmr-r04 PRIVATE -Wall -Wextra -Wpedantic -Werror)
endif()
if(MINGW)
  target_link_options(fgmr-r04 PRIVATE -municode)
endif()

if(BUILD_TESTING AND FGMR_BUILD_TESTS)
add_executable(fgmr-r05-test tests/test_r05.cpp)
target_link_libraries(fgmr-r05-test PRIVATE fgmr-projection)
foreach(target IN ITEMS fgmr-r05-test)
  if(MSVC)
    target_compile_options(${target} PRIVATE /W4 /utf-8 /WX)
  else()
    target_compile_options(${target} PRIVATE -Wall -Wextra -Wpedantic -Werror)
  endif()
endforeach()

endif()

add_executable(fgmr-r06-sample src/model-sample.cpp)
target_link_libraries(fgmr-r06-sample PRIVATE fgmr-occupancy fgmr-projection)
if(MSVC)
  target_compile_options(fgmr-r06-sample PRIVATE /W4 /utf-8 /WX)
else()
  target_compile_options(fgmr-r06-sample PRIVATE -Wall -Wextra -Wpedantic -Werror)
endif()
if(MINGW)
  target_link_options(fgmr-r06-sample PRIVATE -municode)
endif()


# R06-S2B2: independent C05 sampling of one whole-object FGM model.
add_executable(fgmr-r06-multicell-sample src/multicell-sample.cpp)
target_link_libraries(fgmr-r06-multicell-sample PRIVATE fgmr-whole-sample nlohmann_json::nlohmann_json)
if(MSVC)
  target_compile_options(fgmr-r06-multicell-sample PRIVATE /W4 /utf-8 /WX)
else()
  target_compile_options(fgmr-r06-multicell-sample PRIVATE -Wall -Wextra -Wpedantic -Werror)
endif()

add_executable(fgmr-r06-whole-build src/whole-build-main.cpp)
target_link_libraries(fgmr-r06-whole-build PRIVATE fgmr-whole-build)
if(MSVC)
  target_compile_options(fgmr-r06-whole-build PRIVATE /W4 /utf-8 /WX)
else()
  target_compile_options(fgmr-r06-whole-build PRIVATE -Wall -Wextra -Wpedantic -Werror)
endif()
if(MINGW)
  target_link_options(fgmr-r06-whole-build PRIVATE -municode)
endif()

add_executable(fgmr-r07-fit src/panel-fit.cpp)
target_link_libraries(fgmr-r07-fit PRIVATE fgm::raster fgm::cpu nlohmann_json::nlohmann_json)
if(MSVC)
  target_compile_options(fgmr-r07-fit PRIVATE /W4 /utf-8 /WX)
else()
  target_compile_options(fgmr-r07-fit PRIVATE -Wall -Wextra -Wpedantic -Werror)
endif()

# R07-EARLY-MVP S0: только локальная source-to-cell проверка и C05/R05 baseline.
# Для CI — исключительно синтетические данные, нативный исполнитель без второго R04/R05.

# R07-S1A: opt-in continuous-surface R05 ray observations, never replacing R05/LOFT.
add_executable(fgmr-r07-surface src/r07-surface-main.cpp)
target_link_libraries(fgmr-r07-surface PRIVATE fgmr-occupancy fgmr-projection
  fgmr-sha256 fgm::cpu nlohmann_json::nlohmann_json)
if(MSVC)
  target_compile_options(fgmr-r07-surface PRIVATE /W4 /utf-8 /WX)
else()
  target_compile_options(fgmr-r07-surface PRIVATE -Wall -Wextra -Wpedantic -Werror)
endif()

# R07-S1B0: private/local source-bound R03 / R04 / R05 / C05 constrained fit pilot.
# Public CI runs original synthetic fixtures only.

# R07-S1B1A: independently pinned B1 membership ↔ exact local source ↔ native R03, no fitted whole object.

# R07-S1B1B0: opt-in whole-FGM, strict joint C05 across 2..8 local cells,
# then separately observed continuous R05 cell silhouettes in one FGM basis.
add_executable(fgmr-r07-whole-surface src/r07-whole-surface-main.cpp)
target_link_libraries(fgmr-r07-whole-surface PRIVATE fgmr-whole-sample
  fgmr-projection fgmr-sha256 fgm::cpu nlohmann_json::nlohmann_json)
if(MSVC)
  target_compile_options(fgmr-r07-whole-surface PRIVATE /W4 /utf-8 /WX)
else()
  target_compile_options(fgmr-r07-whole-surface PRIVATE -Wall -Wextra -Wpedantic -Werror)
endif()

# R07-S1B1B1A: strictly synthetic multi-observation joint-fit of ONE whole FGM.
# Native R07-S1B1B0 remains the only C05/raster evaluator.

# RV01: синтетическая диагностика и контракт локального просмотрщика без игровых ресурсов

if(BUILD_TESTING AND FGMR_BUILD_TESTS)
  find_package(Python3 REQUIRED COMPONENTS Interpreter)
  find_program(FGMR_NODE_EXECUTABLE NAMES node REQUIRED)
  add_test(NAME r12-cli COMMAND "${Python3_EXECUTABLE}" "${CMAKE_CURRENT_SOURCE_DIR}/tests/test_cli.py" "$<TARGET_FILE:fgm-regenerator>")
  add_test(NAME r01-free-corpus COMMAND "${Python3_EXECUTABLE}" "${CMAKE_CURRENT_SOURCE_DIR}/tests/test_corpus.py")
  add_test(NAME r02-map-mcd-facts COMMAND "${Python3_EXECUTABLE}" "${CMAKE_CURRENT_SOURCE_DIR}/tests/test_r02.py" "$<TARGET_FILE:fgmr-r02>")
  add_test(NAME r03-loft-voxels COMMAND "${Python3_EXECUTABLE}" "${CMAKE_CURRENT_SOURCE_DIR}/tests/test_r03.py" "$<TARGET_FILE:fgmr-r03>")
  add_test(NAME r04-sprite-facts COMMAND "${Python3_EXECUTABLE}" "${CMAKE_CURRENT_SOURCE_DIR}/tests/test_r04.py" "$<TARGET_FILE:fgmr-r04>")
  add_test(NAME r05-projection COMMAND fgmr-r05-test)
  add_test(NAME r06-reconstruction COMMAND "${Python3_EXECUTABLE}" "${CMAKE_CURRENT_SOURCE_DIR}/tests/test_r06.py"
    "${CMAKE_CURRENT_SOURCE_DIR}/scripts/reconstruct_r06.py" "$<TARGET_FILE:fgmr-r06-sample>"
    "$<TARGET_FILE:fgmr-r03>" "$<TARGET_FILE:fgmr-r04>")
  add_test(NAME r06-entity-evidence COMMAND "${Python3_EXECUTABLE}" "${CMAKE_CURRENT_SOURCE_DIR}/tests/test_r06_evidence.py"
    "${CMAKE_CURRENT_SOURCE_DIR}/scripts/build_r06_evidence.py" "$<TARGET_FILE:fgmr-r02>"
    "${CMAKE_CURRENT_SOURCE_DIR}/scripts/verify_r06_membership.py")
  add_test(NAME r06-whole-object COMMAND "${Python3_EXECUTABLE}" "${CMAKE_CURRENT_SOURCE_DIR}/tests/test_r06_multicell.py"
    "${CMAKE_CURRENT_SOURCE_DIR}/scripts/assemble_r06_multicell.py" "$<TARGET_FILE:fgmr-r06-multicell-sample>")
  add_test(NAME r06-whole-build-native COMMAND "${Python3_EXECUTABLE}" "${CMAKE_CURRENT_SOURCE_DIR}/tests/test_whole_build.py"
    "${CMAKE_CURRENT_SOURCE_DIR}/scripts/assemble_r06_multicell.py" "$<TARGET_FILE:fgmr-r06-multicell-sample>"
    "$<TARGET_FILE:fgmr-r06-whole-build>")
  add_test(NAME r07-panel-fit COMMAND "${Python3_EXECUTABLE}" "${CMAKE_CURRENT_SOURCE_DIR}/tests/test_r07.py"
    "${CMAKE_CURRENT_SOURCE_DIR}/scripts/run_r07.py" "$<TARGET_FILE:fgmr-r07-fit>")
  add_test(NAME r07-local-source-baseline COMMAND "${Python3_EXECUTABLE}"
    "${CMAKE_CURRENT_SOURCE_DIR}/tests/test_r07_local_observation.py"
    "${CMAKE_CURRENT_SOURCE_DIR}/scripts/r07_local_observation.py" "$<TARGET_FILE:fgmr-studio-native>")
  add_test(NAME r07-surface-observability COMMAND "${Python3_EXECUTABLE}"
    "${CMAKE_CURRENT_SOURCE_DIR}/tests/test_r07_surface.py" "$<TARGET_FILE:fgmr-r07-surface>")
  add_test(NAME r07-local-constrained-fit COMMAND "${Python3_EXECUTABLE}"
    "${CMAKE_CURRENT_SOURCE_DIR}/tests/test_r07_local_fit.py"
    "${CMAKE_CURRENT_SOURCE_DIR}/scripts/r07_local_fit.py"
    "$<TARGET_FILE:fgmr-studio-native>" "$<TARGET_FILE:fgmr-r03>"
    "$<TARGET_FILE:fgmr-r07-surface>")
  add_test(NAME r07-whole-source-preflight COMMAND "${Python3_EXECUTABLE}"
    "${CMAKE_CURRENT_SOURCE_DIR}/tests/test_r07_whole_source_preflight.py"
    "${CMAKE_CURRENT_SOURCE_DIR}/scripts/r07_whole_source_preflight.py"
    "$<TARGET_FILE:fgmr-studio-native>" "$<TARGET_FILE:fgmr-r03>"
    "${CMAKE_CURRENT_SOURCE_DIR}/scripts/r07_whole_source_fit.py"
    "$<TARGET_FILE:fgmr-r06-whole-build>" "$<TARGET_FILE:fgmr-r07-whole-surface>")
  add_test(NAME r07-whole-surface-observability COMMAND "${Python3_EXECUTABLE}"
    "${CMAKE_CURRENT_SOURCE_DIR}/tests/test_r07_whole_surface.py"
    "$<TARGET_FILE:fgmr-r07-whole-surface>")
  add_test(NAME r07-whole-joint-synthetic-fit COMMAND "${Python3_EXECUTABLE}"
    "${CMAKE_CURRENT_SOURCE_DIR}/tests/test_r07_whole_joint_fit.py"
    "${CMAKE_CURRENT_SOURCE_DIR}/scripts/r07_whole_joint_fit.py"
    "$<TARGET_FILE:fgmr-r07-whole-surface>")
  add_test(NAME rv01-reconstruction-viewer COMMAND "${Python3_EXECUTABLE}" "${CMAKE_CURRENT_SOURCE_DIR}/tests/test_rv01.py"
    "${CMAKE_CURRENT_SOURCE_DIR}/scripts/export_rv01.py"
    "${CMAKE_CURRENT_SOURCE_DIR}/scripts/run_r07.py"
    "$<TARGET_FILE:fgmr-r07-fit>" "${CMAKE_CURRENT_SOURCE_DIR}/viewer/index.html")

  add_test(NAME regenerator-studio-protocol COMMAND "${FGMR_NODE_EXECUTABLE}"
    "${CMAKE_CURRENT_SOURCE_DIR}/tests/test_studio.mjs" "$<TARGET_FILE:fgmr-studio-native>")
  add_test(NAME regenerator-studio-cell COMMAND "${FGMR_NODE_EXECUTABLE}"
    "${CMAKE_CURRENT_SOURCE_DIR}/tests/test_studio_cell.mjs" "$<TARGET_FILE:fgmr-studio-native>")
  add_test(NAME regenerator-studio-catalog COMMAND "${FGMR_NODE_EXECUTABLE}"
    "${CMAKE_CURRENT_SOURCE_DIR}/tests/test_studio_catalog.mjs" "$<TARGET_FILE:fgmr-studio-native>")
  add_test(NAME regenerator-studio-whole COMMAND "${FGMR_NODE_EXECUTABLE}"
    "${CMAKE_CURRENT_SOURCE_DIR}/tests/test_studio_whole.mjs" "$<TARGET_FILE:fgmr-studio-native>"
    "$<TARGET_FILE:fgmr-r06-multicell-sample>" --builder "$<TARGET_FILE:fgmr-r06-whole-build>")
  set_tests_properties(regenerator-studio-protocol regenerator-studio-cell
    regenerator-studio-catalog regenerator-studio-whole PROPERTIES
    WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}" ENVIRONMENT "PYTHON=${Python3_EXECUTABLE}" TIMEOUT 300)
endif()
