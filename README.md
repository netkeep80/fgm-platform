# FGM Platform — единая платформа Fractal Generative Models

Локальная native-сборка объединяет Core, общую CPU Raster реализацию и Regenerator, а также native scene/camera Renderer. Текущее состояние принятия и следующий этап находятся в [Issue #1](https://github.com/netkeep80/fgm-platform/issues/1); README описывает устройство и команды Platform.

**Единственная точка восстановления проекта после окончания чата:** [CONTROL Issue #1](https://github.com/netkeep80/fgm-platform/issues/1). [Протокол журнала и контрольных точек #2](https://github.com/netkeep80/fgm-platform/issues/2). [Начальный этап RepoGuard #3](https://github.com/netkeep80/fgm-platform/issues/3). [Покрытие старой истории/roadmap #15](https://github.com/netkeep80/fgm-platform/issues/15).

## Назначение и границы

- `core/`: FGM-0, каноническая модель, математическая семантика, C04/C05.
- `raster/`: единая CPU RVI реализация для R07 и Renderer oracle.
- `regenerator/`: R01–R07, исходные наблюдения, происхождение данных, whole-object fit.
- `renderer/`: RendererSession, WebGPU и производная геометрия.
- `studio/` (будущий): общий Native/WASM интерфейс, локальный эксперимент и проверенный автоматический Pages release.

`netkeep80/ufo-fractal` остаётся отдельным игровым GPLv3-продуктом. Оригинальные данные UFO/TFTD и производные игровые ресурсы остаются в приватном контуре; **никаких** MAP/MCD/LOFT/PCK/TAB/game images/derived FGM в публичном GitHub, Issues, CI или Pages.

## Native-сборка Platform

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run test:node --workspace renderer
cmake -S . -B build/native -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTING=ON
cmake --build build/native --config Release --parallel 2
node scripts/check-ctest.mjs build/native --suite platform --config Release
ctest --test-dir build/native -C Release --output-on-failure --verbose --no-tests=error
```

[Архитектура и проверка Platform](docs/platform.md): один граф локальных targets, 30 обязательных native/Python/C05 CTests и отдельный public API consumer. Core, Regenerator и Renderer не загружают друг друга через Git FetchContent. Предметные отрицательные тесты и current policy работают на текущем HEAD; WASM/browser собираются из того же Platform checkout. Полный исторический архив старых репозиториев не требуется.

## Управление принятием

Единственные нормативные источники — файлы `requirements/**/*.rg.yaml`, включая FGMP в корне и независимые ветви FGMC/FGMR/FGMV. [Протокол переноса S03](docs/requirements-migration.md) и [машинный реестр](docs/requirements-migration.json) сохраняют происхождение и точные преобразования 73 требований. Все перенесённые субъекты пока имеют lifecycle false/false/false; исходные флаги сохранены отдельно. `accepted:true` внутри **Draft PR** — предлагаемое значение для будущего принятого снапшота, **не самостоятельная авторская приёмка**. До независимого аудита exact HEAD/TREE и явного авторского подтверждения нельзя переводить PR в Ready/merge или объявлять требования действующими.

RepoGuard v6.0.1 закреплён на `74db97791e6da8a75287164f0d0b41579108f114`. CI выполняет локальные положительные и отрицательные проверки bootstrap и затем RepoGuard `base/head`. Настоящая блокирующая защита `main` требует отдельной настройки required check в GitHub rulesets; зелёный workflow сам по себе не доказывает включённую protection.

## Очередность

[S00 RepoGuard](https://github.com/netkeep80/fgm-platform/issues/3) → [S01 source lock](https://github.com/netkeep80/fgm-platform/issues/4) → [S02 снимки файлов](https://github.com/netkeep80/fgm-platform/issues/5) → [S03 requirement migration](https://github.com/netkeep80/fgm-platform/issues/6) → [S04 Core](https://github.com/netkeep80/fgm-platform/issues/7) → [S05 Regenerator](https://github.com/netkeep80/fgm-platform/issues/8) → [S06 Renderer](https://github.com/netkeep80/fgm-platform/issues/9) → [S07 Live Studio](https://github.com/netkeep80/fgm-platform/issues/10) → [S08 cutover](https://github.com/netkeep80/fgm-platform/issues/14).

**Цель миграции — самостоятельный рабочий срез Platform с актуальными требованиями и незавершёнными задачами. Полная история старых репозиториев не архивируется; после финальных FUNCTIONAL/INDEPENDENCE/REQUIREMENTS/SIMPLIFICATION PASS и отдельной авторской приёмки они могут быть удалены. Новый live Studio/Pages принимается отдельно; текущий опубликованный сайт этой интеграцией не переключается.**

Защита `main` [отложена по явному решению автора](https://github.com/netkeep80/fgm-platform/issues/27#issuecomment-6962327932) и не входит в текущие условия merge. Сохраняются независимый аудит exact HEAD/TREE, авторская приёмка, свежий RepoGuard и слияние с проверкой ожидаемого SHA.
