# Первый кадр FGM

Обе сборки читают одну синтетическую сферу и выбирают её поле на плоскости через принятое ядро C05. Общий шейдер WGSL раскрашивает значения поля на сетке 128×128. Браузер показывает буфер на холсте, нативная программа сохраняет кадр PPM. Оба варианта выполняют шейдер через WebGPU. Сцена демонстрирует перенос вычислительного пути. Пространственная видимость и рекурсивная композиция входят в V02. [план Platform](https://github.com/netkeep80/fgm-platform/issues/15) · [план Platform](https://github.com/netkeep80/fgm-platform/issues/15)

## Браузер

Активируйте Emscripten 4.0.21, установите CMake 3.24 или новее и Node.js 24 или новее. Выполните команды из корня репозитория.

~~~sh
npm ci --ignore-scripts --no-audit --no-fund
emcmake cmake -S . -B build/wasm -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTING=OFF
cmake --build build/wasm --parallel
npm run build --workspace renderer
python -m http.server 8000 --bind 127.0.0.1 --directory renderer/build/web
~~~

Откройте http://127.0.0.1:8000 в браузере с поддержкой WebGPU. Кнопка перезапуска уничтожает устройство. Обработчик потери заново создаёт устройство и повторяет вывод. Повторная непреднамеренная потеря при автоматическом восстановлении завершает попытку с сообщением. Если API или адаптер недоступны, страница сообщает причину.

Диагностическая страница собирается локально в `renderer/build/web`. Текущий root CI сохраняет проверенную Studio и кадры в `platform-browser-review`; отдельного pipeline выпуска V01 нет.

## Нативный кадр

Распакуйте подходящий архив wgpu-native v29.0.1.1. Нужны CMake и компилятор C++20. Под Linux требуется доступный Vulkan-адаптер, например Mesa lavapipe. Для Windows предусмотрен архив MSVC x86-64 и копирование DLL рядом с исполняемым файлом. [Архивы wgpu-native](https://github.com/gfx-rs/wgpu-native/releases/tag/v29.0.1.1)

~~~sh
cmake -S . -B build/gpu -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTING=OFF -DFGMV_BUILD_GPU_DEMO=ON -DWGPU_ROOT=/path/to/wgpu
cmake --build build/gpu --config Release --parallel 2 --target fgm_boot
build/gpu/renderer/fgm_boot renderer/web/sphere.fgm.json renderer/web/scene.wgsl build/gpu/sphere.ppm
~~~

При сборке Visual Studio исполняемый файл находится в `build/gpu/renderer/Release/fgm_boot.exe`. Core берётся из локального target `fgm::cpu` той же Platform.

## Проверка

`npm run test:browser --workspace renderer` запускает подготовленный пакет в Chromium и сравнивает каждый RGB-канал с кадром PPM. Тест проверяет фон, наличие фигуры, непрозрачность кадра и повторный кадр после перезапуска устройства. Отдельно проверяется сообщение об отсутствии WebGPU. Для другого пути к нативному кадру используется `FGM_NATIVE_FRAME`, для установленного Chromium — `FGM_CHROMIUM`. Программный адаптер CI подтверждает один воспроизводимый путь исполнения. [Тест](../tests/browser.test.mjs)
