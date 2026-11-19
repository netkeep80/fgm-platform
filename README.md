# FGM Platform — единая платформа Fractal Generative Models

**[Открыть FGM Studio](https://netkeep80.github.io/fgm-platform/)** — локальная реконструкция и просмотр FGM в браузере.

Platform объединяет математический Core, CPU Raster, Regenerator и Renderer в одном исходном дереве, одной native/WASM сборке и одном CI/CD. Текущее состояние проекта: [Issue #1](https://github.com/netkeep80/fgm-platform/issues/1). Незавершённые продуктовые задачи: [roadmap #15](https://github.com/netkeep80/fgm-platform/issues/15).

## Сборка и тесты

Нужны CMake ≥3.24, компилятор C++20, Python 3 и Node.js 24. Команды выполняются из корня репозитория:

```sh
npm ci --ignore-scripts --no-audit --no-fund
node --test tests/workflow.test.mjs tests/ctest-gate.test.mjs tests/document-language.test.mjs
node scripts/check-workflow.mjs
npm run test:node --workspace renderer
cmake -S . -B build/native -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTING=ON
cmake --build build/native --config Release --parallel 2
node scripts/check-ctest.mjs build/native --suite platform --config Release
ctest --test-dir build/native -C Release --output-on-failure --verbose --no-tests=error
```

30 обязательных native/Python/C05 CTests включают самостоятельного потребителя публичного Core API. Пустые, неполные и отключённые наборы тестов отвергаются. [Сборка WASM, архитектура и границы проверок](docs/platform.md).

## Модули

| Каталог | Ответственность |
|---|---|
| `core/` | Единственный FGM evaluator, каноническая модель, сериализация и C05 |
| `raster/` | Единственная CPU RVI реализация и независимые геометрические эталоны |
| `regenerator/` | R01–R07, безопасное локальное чтение данных, реконструкция и whole-object fit |
| `renderer/` | Scene/camera, RendererSession, WebGPU и интерфейс `renderer/studio/` |

Core используется локально. Regenerator и Renderer не зависят друг от друга. Python выполняет необходимые задачи разбора, оркестрации и пакетирования.

## Публикация

**Каждый принятый merge в `main`, включая изменения документации, автоматически обновляет GitHub Pages после обязательных проверок.** Один workflow собирает и проверяет native/WASM/Chromium, затем публикует тот же проверенный пакет. Публичные SHA/TREE, версия, hashes и настоящий WASM smoke подтверждаются перед сохранением подписанного Release. [Контракт и команды работы с пакетами](renderer/docs/studio-pages.md).

## Требования и разработка

Нормативные источники — `requirements/**/*.rg.yaml`; [единая иерархия](docs/requirements-hierarchy.md) связывает требования, реализацию и тесты. RepoGuard v6.0.1 проверяет точные BASE/HEAD, J1/J2/J3 и причинность изменений. Действуют независимый exact-HEAD аудит и отдельная авторская приёмка перед Ready/merge; lifecycle не повышается автоматически. Защита `main` [отложена автором](https://github.com/netkeep80/fgm-platform/issues/27#issuecomment-6962327932). [Протокол работы](https://github.com/netkeep80/fgm-platform/issues/2).

Публичные примеры и CI используют только синтетические данные. Оригинальные UFO/TFTD MAP/MCD/LOFT/PCK/TAB, изображения и производные игровые ресурсы не публикуются. `ufo-fractal` остаётся самостоятельной GPLv3-игрой; Platform имеет собственную лицензию Unlicense. Private Stage A, browser R07 fit и Stage B — отдельные задачи roadmap, а не результат сборки этого репозитория.
