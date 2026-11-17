# Иерархия требований FGM Platform (bootstrap)

**Контрольная Issue:** https://github.com/netkeep80/fgm-platform/issues/1  
**Нормативная база:** `requirements/*.rg.yaml`. Этот документ — пояснение, а не альтернативный источник требований.

## Корни

- `FGMP-PRODUCT-000` — направление продукта: единая FGM-платформа, авторитетный Core, Regenerator, Renderer, Studio, проверяемые границы.
- `FGMP-PROJECT-000` — управление: точные Git/CI свидетельства, независимый аудит, авторская приёмка и безопасность исходных игровых данных.

Корни описывают **предлагаемую** целевую модель bootstrap. Их lifecycle в исходниках является предложением для принятого merge, но **не выражает принятие до явного авторского решения**.

## Планируемое добавление старых ветвей

`requirements/core/FGMC-*`, `requirements/regenerator/FGMR-*`, `requirements/renderer/FGMV-*`. Поддержку вложенных requirements и связь old→new subject identity проверить отдельным этапом [S03](https://github.com/netkeep80/fgm-platform/issues/6). Нельзя импортировать lifecycle=accepted только потому, что старый источник был принят: будет migration audit и новая авторская приёмка.

`implemented_by`, `verified_by`, `documents` ссылаются на точные пути этого репозитория; связность проверяется RepoGuard J1/J2/J3. Обычный CI реально запускает конкретные предметные тесты и не подменяется наличием link `verified_by`.

## Граница старых репозиториев

`fgm-core`, `fgm-regenerator` и `fgm-renderer` сохраняют все исходные commits, Requirements, PR и audit receipts до подтверждённого cutover. Весь контекст старых Issues/PR индексируется в [S09](https://github.com/netkeep80/fgm-platform/issues/15). Приватные игровые файлы никогда не добавляются в публичную миграцию.

## Bootstrap CI

`node --test tests/bootstrap.test.mjs` — actual positive+negative tests цепочки ссылок и pin; `node scripts/check-bootstrap.mjs` — проверка рабочего снимка; затем `RepoGuard exact BASE/HEAD` через pinned Action. GitHub required-check protection должна быть включена администратором отдельно.
