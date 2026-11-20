# Требования FGM Platform

Единственный нормативный источник — `requirements/**/*.rg.yaml`. Документация и CI не заменяют авторскую приёмку. [Управление проектом](https://github.com/netkeep80/fgm-platform/issues/1), [протокол](https://github.com/netkeep80/fgm-platform/issues/2), [продуктовый roadmap](https://github.com/netkeep80/fgm-platform/issues/15).

## Структура

| Ветвь | Назначение |
|---|---|
| `requirements/FGMP-*` | Продукт/проект Platform, локальная сборка, Renderer, WASM и release |
| `requirements/core/FGMC-*` | Математическая семантика, пространство, геометрия, сериализация и evaluator |
| `requirements/regenerator/FGMR-*` | Импорт, доказательства происхождения, наблюдения и реконструкция |
| `requirements/renderer/FGMV-*` | Камера, RVI, RendererSession, браузер и Studio |

Всего 80 требований: шесть Platform и 74 предметных. FGMV-NOVEL-001 задаёт четыре глобальных вида одного целого объекта; lifecycle остаётся кандидатным. У предметных ветвей остаются свои PRODUCT/PROJECT корни; ownership не создаёт циклов между модулями. `FGMP-PRODUCT-000` описывает продукт, `FGMP-PROJECT-000` — управление. `FGMP-BUILD-001`, `FGMP-RENDERER-001`, `FGMP-WASM-001` и `FGMP-RELEASE-001` описывают текущие исполняемые интеграционные контракты.

## Связи и исполнение

`implemented_by`, `verified_by` и `documents` указывают на файлы этого репозитория. RepoGuard проверяет J1 — обоснование ресурсов, J2 — корневую связность требований, J3 — причинность перехода BASE/HEAD. Реальные отрицательные compiler transitions отвергают ресурс без владельца, удаление проверяющих связей и отсутствующую цель. Структурная связь с тестом сама по себе не означает его исполнения.

Все 23 предметных execution constraints сохраняют прежние ключи и пути verifiers. `test_pages_release.py` и `test_pages_snapshot.py` теперь непосредственно исполняют 33 существовавших проверки текущего Platform пакета, разделённые на входной bundle и готовый сайт. Общая синтетическая fixture вынесена без дублирования и forwarding aliases; старый V03 publisher удалён. Тесты доверенного CI origin и подписи остаются в `test_studio_release.py`. Точный включённый состав CTest проверяется до исполнения с `--no-tests=error`. YAML workflow, обязательные роли CI, fail-fast shell, разделение прав и автоматический main push проверяются `scripts/check-workflow.mjs` и отрицательными тестами `tests/workflow.test.mjs`.

Изменения нормативного текста и lifecycle рассматриваются независимо на exact HEAD/TREE. Сохранены значения lifecycle существующих субъектов; добавление или перенос связей не означает новую авторскую приёмку. Изменения реализации проверяются прямыми предметными тестами и review, без запрета развивать исходники через фиксированные старые blob/hash policy.

## Границы продукта

Синтетические native/WASM/GPU проверки подтверждают заявленный корпус, а не произвольные игровые данные или все модели FGM. Private Stage A, новые объекты, анимация, художественные профили и интерактивный R07 принимаются отдельными срезами [roadmap](https://github.com/netkeep80/fgm-platform/issues/15). Миграция завершена; прежние репозитории удалены.
