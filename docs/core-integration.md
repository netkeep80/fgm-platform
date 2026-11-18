# S04 — локальная сборка и предметные проверки Core

**Этап:** [Issue #7](https://github.com/netkeep80/fgm-platform/issues/7). Нормативный источник среза — `FGMP-MIG-CORE-001`. Реестр `core-integration.json` описывает ожидаемое преобразование; фактические результаты подтверждаются первичными CI logs на exact HEAD.

## Исходная база и границы

База S04 — принятый S03 merge `e883bea583d7298ec2747375ebebeb01405a59a1`, TREE `e0f16e7dcbbb66f713f9e3a529291e2e632f78bb`. Core уже импортирован. Повторного Git FetchContent исходного `fgm-core` для корневой сборки нет: используется `add_subdirectory(core)` и прежний `fgm::cpu`.

Публичный `core/include/fgm/evaluator.hpp`, `core/src/evaluator.cpp`, все исходные тесты, witnesses и синтетические fixtures сохраняются побайтно. Из 232 обычных module files изменяется ровно один: `core/CMakeLists.txt`, где добавлена опция `FGMC_BUILD_TESTS` с прежним поведением по умолчанию. При её выключении внутренние Core tests не создаются, но `BUILD_TESTING` вызывающего проекта не меняется. Это изменение сборочного интерфейса, а не математической семантики или ABI.

Regenerator и Renderer по-прежнему имеют самостоятельные старые CMake/FetchContent пути; их переключение на общий Core относится к S05/S06. WASM, Studio, Stage A этим срезом не объявляются готовыми.

## Сборка из корня

```sh
cmake -S . -B build/core -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTING=ON
cmake --build build/core --config Release --parallel 2
node scripts/check-ctest.mjs build/core --config Release
ctest --test-dir build/core -C Release --output-on-failure --verbose --no-tests=error
```

Корневой CTest запускает исходный `fgm_cpu`, новый `core-c05-parity` и `core-external-consumer`. Прежние 64 Node tests запускаются отдельно в root workflow `core-ci.yml`: FGM-0, space, visual independence, geometry, serialization и document language. Они сохраняют проверки ошибок, canonical bytes, модельных/package hashes, seeds и синтетических эталонов.

JSON-зависимость Core остаётся прежней: nlohmann/json 3.12.0 через точную установленную версию либо архив с фиксированным SHA-256. Возможность сборки без сети не вводится этим срезом. Все собственные build artifacts создаются вне tracked source или под игнорируемым `build/`.

## Контракт потребителя

Отдельный CMake-проект может использовать локальный checkout монорепозитория:

```cmake
include(CTest)
set(FGMC_BUILD_TESTS OFF CACHE BOOL "Тесты библиотеки выключены" FORCE)
add_subdirectory("${FGMP_SOURCE_DIR}/core" core)
target_link_libraries(my_application PRIVATE fgm::cpu)
```

`tests/core/consumer` — именно отдельный проект, не второй target внутри основного CMake scope. Он проверяет наличие `fgm::cpu`, отсутствие внутреннего `fgm_cpu_test` и сохранение собственного `BUILD_TESTING=ON`; затем собирает и запускает программу, использующую только публичный header Core. Установка готового SDK и удалённая дистрибуция не добавлены; прежний standalone путь `cmake -S core` сохраняется с исходным default поведения тестов.

## Сравнение C05

`tests/core/sample.cpp` выполняет настоящий C++ evaluator через публичный API, а `tests/core-parity.test.mjs` независимо получает ожидаемые результаты из сохранённого JavaScript witness. Проверяются все центры сетки 16×16×24: `(x+0.5,y+0.5,z+0.5)` в том же порядке, что в исходном R06 occupancy sampler. Для каждой из 6144 точек сравниваются значение поля (относительный/абсолютный допуск 10⁻¹²), знак заполненности, material и contributor. Пять дополнительных точек проверяют проём, металл, камень, границу и внешнюю область.

Проверка требует непустой и неполной occupancy, сравнивает байты повторного native запуска и все значения при обратном порядке запросов. Ошибочная версия пакета должна завершить native consumer с ошибкой. Canonical bytes, модельный/package hash и сохранённое семя повторно сравниваются с исходным C04 эталоном. Это доказательство выбранной синтетической fixture, а не всех возможных игровых данных.

## Историческая и текущая проверка происхождения

S02 oracle продолжает проверять принятый import HEAD. Неизменённые `check-requirements-migration.mjs` и `requirements-migration.json` проверяют исторический S03 HEAD `4c46d0f3aa2176a8d63448c01df55614ce169956`; S03 mutation tests и реальные отрицательные compiler transitions также работают на этом точном снимке. Старое требование неизменности 232 файлов не отключено и не перенесено молча на новый изменённый код.

Новый `check-core-integration.mjs` проверяет текущий S04 от exact BASE: 231 module file остаётся прежним, единственная допустимая правка Core CMake воспроизводится точным преобразованием. Все 73 исходных нормативных значения, ID, lifecycle и constraints неизменны. Семь Core связей `implemented_by` переводятся с исторического вложенного workflow на активный root workflow. К FGMC-EVAL-001 добавлены корневая сборка и два новых C05 проверяющих артефакта. Исторический вложенный workflow теперь документирует FGMP-MIG-CORE-001. Остальные требования остаются прежними; с новым требованием среза canonical count равен 78.

Матрица CI и полный набор фактических команд проверяются как YAML 1.2 AST без возможности условно пропустить job/step или продолжить после ошибки. Дополнительно версия policy 2 закрепляет точные mode, Git blob и SHA-256 тринадцати критических файлов: корневого CMake, workflow, verifier, native sample, consumer project и исторических CI/harness компонентов. Неизменённые функциональные файлы сравниваются с immutable Git-снимком `c512b24282c29c51dd52301e6ea78a2f8b0ab0ff` / TREE `67bd3a0cb5a3d2a378e6edddf9b491653ef2bfc6`; это источник конкретных байтов, а не приёмка заблокированного candidate. Исправленные/новые файлы имеют фиксированные pins в checker. Ожидания не вычисляются по проверяемому HEAD или его manifest: подмена verifier вместе с обновлённой записью manifest всё равно отвергается.

Сам checker и изменение его pin-policy остаются частью независимого exact-HEAD аудита. Никакой самопроверяющийся исходник не заменяет эту границу доверия: новый HEAD требует нового аудита и авторской приёмки. Реестр версии 2 документирует policy, но не выдаёт себе полномочия менять ожидания.

Mutation tests реально исполняют успешные no-op Node scripts, затем требуют typed отказ current checker. Отдельно проверяются пустые root/consumer CMake, no-op native sample, ослабленный historical workflow, mode drift, изменённые code/requirements/constraints/lifecycle и совместная подмена verifier + manifest. Исторический S03 checker и manifest остаются побайтно прежними.

## Обязательный состав CTest

До запуска тестов `check-ctest.mjs` получает полный `ctest --show-only=json-v1`, требует уникальные имена и точное число включённых тестов с непустыми командами, отвергает DISABLED, WILL_FAIL и skip policies. Корневая suite должна содержать ровно `fgm_cpu`, `core-c05-parity`, `core-external-consumer`; отдельный consumer — только `consumer-public-api`. И корневой, и nested CTest выполняются с `--no-tests=error`.

`tests/ctest-gate.test.mjs` проверяет не только JSON-контрпримеры. В изолированных настоящих CMake-проектах ноль тестов при BUILD_TESTING ON/OFF даёт старый exit 0 и новый nonzero exit с `--no-tests=error`; inventory gate также отвергает обе пустые suite. Два зарегистрированных успешно проходящих теста всё ещё могут дать CTest exit 0, поэтому отдельная проверка точных трёх имён обязательна и тоже должна отвергнуть такой проект.

RepoGuard остаётся единым compiler на `74db97791e6da8a75287164f0d0b41579108f114`. Семь Core execution constraints с новым workflow могут иметь результат `DELEGATED`: это структурное направление к проверяющим программам. Успех предметных тестов подтверждает отдельный Core job на каждой ОС, а не это слово в отчёте compiler. Остальные execution constraints Regenerator/Renderer остаются работой S05/S06.
