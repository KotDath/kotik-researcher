---
name: kotik-small-change
description: Ведёт локальную обратимую правку приложения через облегчённый SDD-профиль. Use when пользователь просит небольшое изменение существующего поведения, текста, настройки или UI без новой capability и без неизвестной причины дефекта. NOT FOR bugs (kotik-bugfix), новых возможностей (kotik-feature), migrations, embeddings, nested agent workflows, permissions или formal logic.
---

# Small change

1. Объявить профиль и проверить:
   - изменение локально и обратимо;
   - затрагивает не более одного продуктового контура;
   - нет semantic escalator: data identity/migration/provenance,
     embeddings/reindex, nested workflow, permissions, formal logic,
     breaking IPC/API.
2. При нарушении любого условия переключиться на `kotik-feature` или
   `kotik-bugfix` и объяснить причину.
3. Делегировать `spec-writer-fast` компактный proposal/delta/tasks без
   vision.md и design.md. В routing card: `Profile: small-change`,
   `Size: small`, contours и risk.
4. Получить явное подтверждение пользователя через `kotik-approve`.
5. Реализацию делегировать Flash implementer.
6. Выполнить deterministic checks из tasks.md, затем reviewer.
7. Если меняется пользовательский flow — app-tester. При renderer/both —
   ui-reviewer; ui-designer только для новой визуальной грамматики или
   существенного визуального дефекта.

Research допускается вложенно только для конкретного внешнего факта.
