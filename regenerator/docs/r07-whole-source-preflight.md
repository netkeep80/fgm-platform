# R07-S1B1A — предварительная проверка целого объекта по исходникам

**Статус:** кандидат; [план Platform](https://github.com/netkeep80/fgm-platform/issues/11), родитель [план Platform](https://github.com/netkeep80/fgm-platform/issues/11). S1B0 PR #55 (историческая запись) принят и смержен. Новый срез **не** проводит общий fit, не выпускает Stage A acceptance и не доказывает истинность объектной идентичности по одной MCD.

## Архитектура и границы

1. R06-S2B1 (verify_r06_membership.py) независимо пересобирает граф R02 из точных MAP/MCD с отдельным локальным source-witness и выпускает проверенный verified-membership-input-v1 receipt. Утверждение о принадлежности остаётся **условным на истинность внешнего свидетельства**, не криптографически удостоверенным независимым лицом.
2. R07-S0 (r07_local_observation.py) сверяет SHA-256 исходных MAP/MCD/LOFT/PCK/TAB/палитры. S1B1A требует совпадения map_sha256 и полного упорядоченного списка dataset ID/SHA в B1 receipt с теми же проверенными байтами. Подмена, перестановка или пропуск набора не допускаются.
3. Выбранное исходное R04/R05-наблюдение должно принадлежать ровно одному члену B1 (xyz, TilePart, dataset, local MCD index). Допускаются 1–8 разных клеток и **одна** TilePart на клетку. Соседство, общая MCD, случайный object_key либо status=explicit в S0 не дают права добавлять части.
4. Для **каждого** B1 члена запускается уже принятый native R03 на том же проверенном снимке. Проверяются xyz, map_record, TilePart, dataset, local MCD index, 12 LOFT ID и 384 маски 16-битных строк (24×16). Python не содержит второй реализации LOFT-декодера. Для выбранной части native Studio повторно проверяет действительные R04/R05/R06/C05, непустой исходный спрайт и совпадение LOFT IDs с R03.
5. Инструменты Studio и R03 запускаются как копии байтов, SHA которых сверены с внешними ожидаемыми SHA (reuse R06-S2B1 pinned-executable path). Это не удостоверяет исходный код/сборку или динамические библиотеки само по себе.

## Запуск — исключительно приватно/локально

Сначала создать локальный B1 verified receipt и независимые ожидаемые SHA согласно [R06-S2B1](r06-s2b1-verified-membership.md). Манифест selection по [R07-S0](r07-mvp-local-source-baseline.md) должен ссылаться на тот же MAP/MCD dataset order.

Пример синтаксиса (все пути и digest — локальные заполнители):

    python scripts/r07_whole_source_preflight.py \
      --manifest /PRIVATE/selection.json \
      --verified /PRIVATE/verified-membership.json \
      --verified-sha256 EXPECTED_B1_SHA256 \
      --studio-native build/fgmr-studio-native \
      --studio-sha256 EXPECTED_STUDIO_SHA256 \
      --r03-native build/fgmr-r03 \
      --r03-sha256 EXPECTED_R03_SHA256 \
      --output /PRIVATE/whole-source-preflight.json

На Windows используются .exe из build/Release. Предоставляемые SHA должны быть зафиксированы отдельно от запуска. Результат создаётся атомарно только при отсутствии имени (R06-S2B1 hard-link create-if-absent). При ошибке выход 2, без нового receipt и без локальных путей/байтов в диагностике.

## Семантика приватного результата

Схема fgmr-r07-whole-source-preflight/1 содержит status=LOCAL_MEMBERSHIP_AND_SOURCE_CROSS_BOUND, stage_a=NOT_ACCEPTED, object_identity=CONDITIONAL_ON_B1_WITNESS_NOT_AUTHENTICATED. Хранит SHA B1, источников и закреплённых executables, все verified source/cell bindings, по 12 LOFT ID и hash 384 масок каждой части, selected_member и SHA первичного доказательства Studio.

**Что не доказано:** независимая истинность авторского B1-свидетельства; общий параметрический fit; изменение единого FGM при C05 всех клеток; четыре дополнительных 3D-ракурса; реконструкция скрытых граней; запуск на настоящем оригинальном UFO; Stage A acceptance. Более того, текущая область не включает две TilePart одной клетки или более восьми клеток.

**Приватная граница:** не публиковать в GitHub, CI, Pages, Issues, PR исходные MAP/MCD/LOFT/PCK/TAB/палитры, selection, B1 receipt, этот receipt, модели/изображения и локальные пути. Публичные тесты используют только самостоятельно созданные синтетические исходники.

## Следующий линейный срез

R07-S1B1B после отдельного независимого аудита/приёмки S1B1A: единая FGM-программа и её **joint** параметрический fit со строгим C05 на всех клетках, реальное локальное UFO-наблюдение и четыре новых контрольных 3D-ракурса. Никакого утверждения о завершении R07-EARLY-MVP до этого момента.
