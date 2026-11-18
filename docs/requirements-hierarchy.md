# Иерархия требований FGM Platform

**Контрольная Issue:** https://github.com/netkeep80/fgm-platform/issues/1  
**Нормативная база:** `requirements/**/*.rg.yaml`. Этот документ — пояснение, а не альтернативный источник требований.

## Корни

- `FGMP-PRODUCT-000` — направление продукта: единая FGM-платформа, авторитетный Core, Regenerator, Renderer, Studio, проверяемые границы.
- `FGMP-PROJECT-000` — управление: точные Git/CI свидетельства, независимый аудит, авторская приёмка и безопасность исходных игровых данных.

Корни описывают **предлагаемую** целевую модель bootstrap. Их lifecycle в исходниках является предложением для принятого merge, но **не выражает принятие до явного авторского решения**.

## Три нормативные ветви S03

`requirements/core/FGMC-*` — 11 требований, `requirements/regenerator/FGMR-*` — 31, `requirements/renderer/FGMV-*` — 31. Каждая ветвь сохраняет собственные PRODUCT/PROJECT корни и исходные requirement relations. Корневые FGMP управляют платформой и переносом; новые связи подчинения между предметными ветвями не добавляются.

73 исходных ID и нормативных текста сохранены. [Протокол S03](requirements-migration.md) и [точный реестр](requirements-migration.json) фиксируют смену repository в semantic subject, префиксы paths, constraints и lifecycle. У всех новых субъектов lifecycle=false/false/false до отдельного решения автора; source lifecycle остаётся в реестре. Всего compiler должен обнаружить 77 требований: 73 перенесённых, три прежних FGMP и новое FGMP-MIG-REQ-001. Проверка выполняется реальным закреплённым RepoGuard и тремя отрицательными переходами на изолированных Git-деревьях.

`implemented_by`, `verified_by`, `documents` ссылаются на точные пути этого репозитория; связность проверяется RepoGuard J1/J2/J3. Предметный CI должен запускать конкретные тесты и не подменяться наличием связи `verified_by`; активация этих запусков в Platform относится к S04–S06.

## Интеграционный срез S04

Новый кандидат FGMP-MIG-CORE-001 связывает локальный Core, корневой CMake, активный `core-ci.yml`, независимый native/reference verifier и фазовую проверку происхождения. С ним текущий canonical count равен 78. Семь Core execution constraints сохраняют прежние verifier keys и получают действующий CI; нормативные тексты, lifecycle и constraints всех 73 перенесённых требований не меняются. Исправление аудита P2 добавляет фиксированные content pins критических verifier/CI и gate точного CTest состава с --no-tests=error, без изменения исходных 73 требований. Подробности — [протокол S04](core-integration.md).

S03 checker с count 77 и frozen 232 module files сохраняется для exact принятого исторического S03 HEAD. Новый S04 checker допускает только заявленное изменение одного Core CMake и документированные обновления relations. Эти проверки относятся к разным нормативным снимкам.

## Граница старых репозиториев

`fgm-core`, `fgm-regenerator` и `fgm-renderer` сохраняют все исходные commits, Requirements, PR и audit receipts до подтверждённого cutover. Весь контекст старых Issues/PR индексируется в [S09](https://github.com/netkeep80/fgm-platform/issues/15). Приватные игровые файлы никогда не добавляются в публичную миграцию.

## Проверки основы CI

`node --test tests/bootstrap.test.mjs` — actual positive+negative tests цепочки ссылок и pin; `node scripts/check-bootstrap.mjs` — проверка рабочего снимка; затем `RepoGuard exact BASE/HEAD` через pinned Action. GitHub required-check protection должна быть включена администратором отдельно.

## S00B — полный нормативный переход, без bootstrap-исключения

[Issue #25](https://github.com/netkeep80/fgm-platform/issues/25) фиксирует использованное разовое исключение исторического BASE. Для любого нового PR RepoGuard v6.0.1 должен проверять **оба нормативных** BASE/HEAD и завершаться SUCCESS без фильтрации diagnostics. Сквозной отрицательный тест `scripts/verify-repoguard-transition.mjs` создаёт отдельный временный Git-репозиторий, проверяет допустимое изменение документа и отвергает введённый не обоснованный Requirement ресурс через **реальный** pinned RepoGuard.

Это тест исполняемого causal compiler, но не свидетельство включённой защиты ветки: required status check и запрет обхода задаются отдельно в GitHub Settings и фиксируются в Issue #25. Историческое условие защиты пересмотрено [явным решением автора](https://github.com/netkeep80/fgm-platform/issues/27#issuecomment-6962327932): установка protection отложена и не является текущим merge gate. Принятый PR #30 завершил S02; независимый аудит, exact author acceptance, свежий RepoGuard и SHA-проверка merge остаются обязательными.
