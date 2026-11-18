# FGM Platform — единая платформа Fractal Generative Models

Статус: **S03 ACCEPTED · S04 CANDIDATE**. Принятые PR #30/#31 перенесли исходные файлы и 73 нормативных требования в монорепозиторий. Текущий срез подключает локальный Core к корневому CMake, активному Linux/Windows CI и проверке native/reference C05. Интеграция Regenerator/Renderer и выпуск общей Studio остаются следующими этапами.

**Единственная точка восстановления проекта после окончания чата:** [CONTROL Issue #1](https://github.com/netkeep80/fgm-platform/issues/1). [Протокол журнала и контрольных точек #2](https://github.com/netkeep80/fgm-platform/issues/2). [Начальный этап RepoGuard #3](https://github.com/netkeep80/fgm-platform/issues/3). [Покрытие старой истории/roadmap #15](https://github.com/netkeep80/fgm-platform/issues/15).

## Назначение и границы

- `core/`: FGM-0, каноническая модель, математическая семантика, C04/C05.
- `regenerator/`: R01–R07, исходные наблюдения, происхождение данных, whole-object fit.
- `renderer/`: RendererSession, WebGPU и производная геометрия.
- `studio/` (будущий): общий Native/WASM интерфейс, локальный эксперимент и проверенный автоматический Pages release.

`netkeep80/ufo-fractal` остаётся отдельным игровым GPLv3-продуктом. Оригинальные данные UFO/TFTD и производные игровые ресурсы остаются в приватном контуре; **никаких** MAP/MCD/LOFT/PCK/TAB/game images/derived FGM в публичном GitHub, Issues, CI или Pages.

## Сборка Core

```sh
cmake -S . -B build/core -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTING=ON
cmake --build build/core --config Release --parallel 2
node scripts/check-ctest.mjs build/core --config Release
ctest --test-dir build/core -C Release --output-on-failure --verbose --no-tests=error
```

[Интеграция и контракт потребителя](docs/core-integration.md) описывают локальный `fgm::cpu`, независимый внешний CMake-проект и проверку 6144 центров C05. Принятые S02/S03 проверяются на исторических коммитах; текущий S04 имеет отдельный [реестр](docs/core-integration.json) и checker. Отдельная авторская приёмка этого Draft среза ещё требуется.

## Управление принятием

Единственные нормативные источники — файлы `requirements/**/*.rg.yaml`, включая FGMP в корне и независимые ветви FGMC/FGMR/FGMV. [Протокол переноса S03](docs/requirements-migration.md) и [машинный реестр](docs/requirements-migration.json) сохраняют происхождение и точные преобразования 73 требований. Все перенесённые субъекты пока имеют lifecycle false/false/false; исходные флаги сохранены отдельно. `accepted:true` внутри **Draft PR** — предлагаемое значение для будущего принятого снапшота, **не самостоятельная авторская приёмка**. До независимого аудита exact HEAD/TREE и явного авторского подтверждения нельзя переводить PR в Ready/merge или объявлять требования действующими.

RepoGuard v6.0.1 закреплён на `74db97791e6da8a75287164f0d0b41579108f114`. CI выполняет локальные положительные и отрицательные проверки bootstrap и затем RepoGuard `base/head`. Настоящая блокирующая защита `main` требует отдельной настройки required check в GitHub rulesets; зелёный workflow сам по себе не доказывает включённую protection.

## Очередность

[S00 RepoGuard](https://github.com/netkeep80/fgm-platform/issues/3) → [S01 source lock](https://github.com/netkeep80/fgm-platform/issues/4) → [S02 снимки файлов](https://github.com/netkeep80/fgm-platform/issues/5) → [S03 requirement migration](https://github.com/netkeep80/fgm-platform/issues/6) → [S04 Core](https://github.com/netkeep80/fgm-platform/issues/7) → [S05 Regenerator](https://github.com/netkeep80/fgm-platform/issues/8) → [S06 Renderer](https://github.com/netkeep80/fgm-platform/issues/9) → [S07 Live Studio](https://github.com/netkeep80/fgm-platform/issues/10) → [S08 cutover](https://github.com/netkeep80/fgm-platform/issues/14).

**Прежние проекты сохраняют исторические Requirements, Issues, PR и свидетельства. Интегрированные сборки и новый live Studio в Platform ещё не приняты. Текущий Pages-сайт прежнего Renderer продолжает работать.**

Защита `main` [отложена по явному решению автора](https://github.com/netkeep80/fgm-platform/issues/27#issuecomment-6962327932) и не входит в текущие условия merge. Сохраняются независимый аудит exact HEAD/TREE, авторская приёмка, свежий RepoGuard и слияние с проверкой ожидаемого SHA.
