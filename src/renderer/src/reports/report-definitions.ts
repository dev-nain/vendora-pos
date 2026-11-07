import {
  paymentMethodColumns,
  salesByCashierColumns,
  salesByCategoryColumns,
  salesByDayColumns,
  salesByHourColumns,
  salesByProductColumns,
  type ExportReportInput,
  type ExportReportResult,
  type PaymentMethodRow,
  type PaymentMethodTotals,
  type ReportColumn,
  type ReportExportFormat,
  type ReportFooterRow,
  type ReportRange,
  type ReportShift,
  type SalesByCashierRow,
  type SalesByCashierTotals,
  type SalesByCategoryRow,
  type SalesByDayRow,
  type SalesByHourRow,
  type SalesByLineTotals,
  type SalesByPeriodTotals,
  type SalesByProductRow,
} from "@shared/reports";

export interface ReportData<Row, Totals> {
  rows: Row[];
  totals: Totals;
  footer?: ReportFooterRow[];
}

export interface ReportDefinition<
  Row extends Record<string, string | number>,
  Totals extends Record<string, number>,
> {
  id: string;
  label: string;
  columns: ReportColumn<Row>[];
  load: (range: ReportRange) => Promise<ReportData<Row, Totals>>;
  exportTo: (input: ExportReportInput) => Promise<ExportReportResult>;
  shifts?: {
    list: (range: ReportRange) => Promise<ReportShift[]>;
    load: (shiftId: string) => Promise<ReportData<Row, Totals>>;
    exportTo: (input: {
      shiftId: string;
      format: ReportExportFormat;
    }) => Promise<ExportReportResult>;
  };
}

const reports = () => window.vendora.reports;

export const salesByDayReport: ReportDefinition<SalesByDayRow, SalesByPeriodTotals> = {
  id: "sales-by-day",
  label: "Sales by day",
  columns: salesByDayColumns,
  load: (range) => reports().salesByDay(range),
  exportTo: (input) => reports().exportSalesByDay(input),
};

export const salesByHourReport: ReportDefinition<SalesByHourRow, SalesByPeriodTotals> = {
  id: "sales-by-hour",
  label: "Sales by hour",
  columns: salesByHourColumns,
  load: (range) => reports().salesByHour(range),
  exportTo: (input) => reports().exportSalesByHour(input),
};

export const salesByProductReport: ReportDefinition<SalesByProductRow, SalesByLineTotals> = {
  id: "sales-by-product",
  label: "Sales by product",
  columns: salesByProductColumns,
  load: (range) => reports().salesByProduct(range),
  exportTo: (input) => reports().exportSalesByProduct(input),
};

export const salesByCategoryReport: ReportDefinition<SalesByCategoryRow, SalesByLineTotals> = {
  id: "sales-by-category",
  label: "Sales by category",
  columns: salesByCategoryColumns,
  load: (range) => reports().salesByCategory(range),
  exportTo: (input) => reports().exportSalesByCategory(input),
};

export const salesByCashierReport: ReportDefinition<SalesByCashierRow, SalesByCashierTotals> = {
  id: "sales-by-cashier",
  label: "Sales by cashier",
  columns: salesByCashierColumns,
  load: (range) => reports().salesByCashier(range),
  exportTo: (input) => reports().exportSalesByCashier(input),
};

export const paymentMethodReport: ReportDefinition<PaymentMethodRow, PaymentMethodTotals> = {
  id: "sales-by-payment-method",
  label: "Sales by payment method",
  columns: paymentMethodColumns,
  load: (range) => reports().paymentMethods({ range }),
  exportTo: (input) => reports().exportPaymentMethods(input),
  shifts: {
    list: (range) => reports().shifts(range),
    load: (shiftId) => reports().paymentMethods({ shiftId }),
    exportTo: (input) => reports().exportPaymentMethods(input),
  },
};
