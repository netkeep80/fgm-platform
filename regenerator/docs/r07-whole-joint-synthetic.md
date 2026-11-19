# R07-S1B1B1A — совместный подбор одной многоклеточной FGM-модели (синтетический gate)

**Статус:** кандидат, [план Platform](https://github.com/netkeep80/fgm-platform/issues/11). База — принятый R07-S1B1B0 PR #59 (историческая запись). Этот срез **не** принимает исходные MAP/MCD/LOFT/PCK/TAB и не является локальной проверкой оригинального UFO; для Stage A он выдаёт только **NOT_ACCEPTED**. Следующий gate должен независимо выполнить R03/S1B1A source binding и R04/R05 наблюдения нескольких частей.

## Разделение математических обязательств

Для единого канонического baseline-пакета `M_0` со строго проверенной грамматикой `r06_multicell_loft_boxes/0.1.0` порождаем конечную сетку параметров:

```text
delta ∈ {-0.98, -0.49, 0.00, +0.49, +0.98}
extent_i.axis := round(extent_i.axis + delta, 3)
offset_i, box_i, move_i, union_i := unchanged
```

Все `extent_N` изменяются **одновременно**; запрещено независимо подгонять клеточные модели. Кандидатная модель использует `generation.algorithm=r07_s1b1b1a_joint_extent`, исходный `baseline_package` SHA в `generation.resources` и детерминированно пересчитанный `model.seed`. Исходный пакет, его внешний SHA, полный граф узлов, ресурсные хеши, формат, материал и общие B1-якоря проверяются *до* нативного запуска.

Если после округления хотя бы один полуразмер кандидата выходит из диапазона `[0.5, 512]`, трассировка фиксирует `OUT_OF_DOMAIN_CANDIDATE_REJECTED`. Поиск продолжает проверять остальные варианты. Невалидная исходная модель по-прежнему прерывает запуск.

Для каждого варианта создаётся **один** запрос к принятому `fgmr-r07-whole-surface`. Только при прохождении общего C05 на всех 2–8 клетках допускается получение пер-клеточных непрерывных R05-пикселей и сравнение с двумя или более аналитическими исходными наблюдениями. Клетка без пиксельного наблюдения остаётся **обязательной** в C05.

```text
C05(M_delta, all cells) → PASS | EXACT_C05_REJECT | FATAL
PASS → per-observation IoU, contour
joint objective = sum(common) / sum(union) (exact rational)
tie-break = symmetric contour L1
per-observation guard = IoU_candidate >= IoU_baseline, for every observed part
```

Кандидат отклоняется по C05 **только** если одновременно получены код возврата 2, пустой stdout и точный stderr `R07-S1B1B0: E_B0_C05_ALL_CELLS_MISMATCH\n`. Неверная версия протокола, модель, digest, недоступный исполнитель, тайм-аут или повреждённые пиксели прерывают весь fit. В нативном текстовом потоке учитываются только два точных варианта окончания этой строки: `LF` (`\n`) в Linux и `CRLF` (`\r\n`) в Windows; дополнительные байты, лишние переводы строки и непустой stdout остаются фатальными. Нативный C05 *не* повторяется средствами Python. Синтетические фиксированные данные не являются доказательством подлинного B1-происхождения объекта.

## Схема локального запроса и запуска

```text
fgmr-r07-whole-joint-synthetic-request/1:
  synthetic_only: true
  baseline_package: canonical fgm-package/1 JSON string
  baseline_sha256: external SHA-256 exact package bytes
  membership_sha256: external SHA-256 synthetic receipt
  material: "stone"
  cells: [2..8] exactly:
    tile, local_xyz, reference_rows[384], reference_rows_sha256,
    p_level, right_half, observed_pixels_xy, observed_sha256
```

Параметр `observed_pixels_xy` равен `null` вместе с `observed_sha256=null` для C05-only клеток; минимум две разные клетки обязаны иметь непустые наблюдения, привязанные к SHA. Подлинность наблюдений *не* подтверждается по одному SHA. Формат строго синтетический: `synthetic_only:false` отклоняется, а результаты никогда не выдаются за реальные данные игры.

```shell
python scripts/r07_whole_joint_fit.py \
  --request /private/synthetic-request.json \
  --native /path/to/fgmr-r07-whole-surface \
  --native-sha256 <exact independently measured executable SHA> \
  --output /private/empty-output-path
```

Результат публикуется одним атомарным переименованием в новый каталог с файлами `whole-baseline.fgm.json`, `whole-candidate.fgm.json` и `joint-fit-receipt.json`. Существующее имя, включая пустой каталог, вызывает `E_B1_OUTPUT_EXISTS`. Платформа и файловая система должны поддерживать переименование с запретом замены. Это частный локальный результат. Производные игровые FGM хранятся вне публичных Issues, CI и Pages.

## Синтетические доказательства

Тесты самостоятельно рассчитывают две прямоугольные поверхности в аналитических координатах без вызова FGM Evaluator: центры (8,8,12) и (24,8,12), half-extent baseline 4.0, целевой 4.49; 12 288 C05-центров неизменны для delta=0 и delta=0.49, площадь проекции каждой части растёт с 192 до 244 пикселей. Оба наблюдения требуют **общего** изменения delta=+0.49. Проверки охватывают реальный native B0, отказ при повреждении C05 каждой части, конфликтные наблюдения, отсутствие второго наблюдения, provenance, грамматику, точные хеши, камеры `p_level/right_half` и повторяемость двух независимых запусков.

**Остаётся незакрытым:** реальный R03 nested rows→SHA S1B1A→flatten 384, отдельные R04/R05 source-bound наблюдения по каждому выбранному члену B1, независимо аутентифицированное ObjectDefinition, профиль камеры с ненулевым offset, межклеточная глубина/окклюзия, тонкая геометрия, четыре настоящих novel 3D вида и исследовательская приёмка Stage A. Кандидат `FGMR-R07-WHOLE-FIT-001` остаётся `accepted:false/current:false/published:false`.
