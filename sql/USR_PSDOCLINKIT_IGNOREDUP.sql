/* ---------------------------------------------------------------------------
   USR_PSDOCLINKIT_IGNOREDUP  -  make duplicate PS_DOC_LIN_KIT inserts harmless.

   Why this exists
   ---------------
   The storefront (store_api.py -> /api/store/order) posts web orders through the
   NCR /Document API, which adds bottle-deposit kit components as LOOSE lines and
   does NOT create the PS_DOC_LIN_KIT row that makes a deposit render nested + blue
   under its parent. store_order back-fills those rows (via USR_REPAIR_PS_DOC_LIN_KIT,
   sourced from IM_KIT_COMP) so the deposit displays correctly.

   However, Counterpoint's Ticket Entry RE-INSERTS the kit-component row whenever
   the document is edited / cancelled / released. With the storefront's row already
   present, that raw INSERT raised:

       Violation of PRIMARY KEY constraint 'PK_PS_DOC_LIN_KIT'.
       Cannot insert duplicate key ... (DOC_ID, LIN_SEQ_NO)

   ...which blocked those operations. This cannot be prevented from the app side
   (it is CP's own client doing the INSERT), so we make the INSERT idempotent at
   the database: an INSTEAD OF INSERT trigger that skips any row whose PK already
   exists. New (non-duplicate) inserts behave exactly as before - including firing
   the existing PDI_PSDOCLINKIT audit trigger.

   Safe because: POS-entered tickets never pre-populate the row, so NOT EXISTS is
   always true for them and the insert is unchanged. Only the storefront's
   already-present rows are skipped on CP's re-insert. Idempotent to re-run.

   To remove:  DROP TRIGGER dbo.USR_PSDOCLINKIT_IGNOREDUP;
--------------------------------------------------------------------------- */
IF OBJECT_ID('dbo.USR_PSDOCLINKIT_IGNOREDUP', 'TR') IS NOT NULL
    DROP TRIGGER dbo.USR_PSDOCLINKIT_IGNOREDUP;
GO

CREATE TRIGGER dbo.USR_PSDOCLINKIT_IGNOREDUP
ON dbo.PS_DOC_LIN_KIT
INSTEAD OF INSERT
AS
BEGIN
    SET NOCOUNT ON;
    -- REQUIRED_COMP is a computed column, so it is not written.
    INSERT INTO dbo.PS_DOC_LIN_KIT
    (DOC_ID, LIN_SEQ_NO, KIT_COMP_QTY, KIT_COMP_QTY_UNIT_FLG, KIT_COMP_UPCHARGE,
     KIT_COMP_ITEM_NO, KIT_COMP_DIM_1_UPR, KIT_COMP_DIM_2_UPR, KIT_COMP_DIM_3_UPR,
     KIT_SUBS_TYP, KIT_PRC_ADJ_TYP, KIT_ADJ_PRC_LVL)
    SELECT i.DOC_ID, i.LIN_SEQ_NO, i.KIT_COMP_QTY, i.KIT_COMP_QTY_UNIT_FLG, i.KIT_COMP_UPCHARGE,
           i.KIT_COMP_ITEM_NO, i.KIT_COMP_DIM_1_UPR, i.KIT_COMP_DIM_2_UPR, i.KIT_COMP_DIM_3_UPR,
           i.KIT_SUBS_TYP, i.KIT_PRC_ADJ_TYP, i.KIT_ADJ_PRC_LVL
    FROM inserted i
    WHERE NOT EXISTS (
        SELECT 1 FROM dbo.PS_DOC_LIN_KIT k
        WHERE k.DOC_ID = i.DOC_ID AND k.LIN_SEQ_NO = i.LIN_SEQ_NO
    );
END
GO
