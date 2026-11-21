// Phân quyền xem dữ liệu giá trị (dùng chung cho máy chủ và bản demo)
//   admin (Quản trị), accountant (Kế toán), viewer (Chỉ xem): xem toàn bộ dữ liệu
//   storekeeper (Thủ kho): chỉ xem số lượng; mọi trường giá trị tiền bị xóa khỏi dữ liệu trả về
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KhoRoles = api;
})(typeof self !== 'undefined' ? self : this, () => {
  const ROLES = {
    admin: 'Quản trị',
    accountant: 'Kế toán',
    storekeeper: 'Thủ kho',
    viewer: 'Chỉ xem',
  };
  const WRITE_ROLES = ['admin', 'accountant'];
  const canSeeValues = (role) => role !== 'storekeeper';

  // Các trường giá trị tiền xuất hiện trong dữ liệu trả về
  const VALUE_KEYS = new Set([
    'opening_value', 'sale_price', 'sale_price_vat',
    'total_amount', 'total_cost', 'total_vat',
    'unit_price', 'price_vat', 'amount', 'discount_rate', 'vat_amount', 'cost_price', 'cost_amount',
    'open_val', 'in_val', 'out_val', 'close_val', 'avg', 'price', 'value', 'bal_val', 'amt',
    'avg_price', 'stock_other', 'revenue', 'cost', 'profit', 'purchase', 'margin',
  ]);
  // Đường dẫn chỉ phục vụ số liệu giá trị: thủ kho không được truy cập
  const VALUE_ONLY_PATHS = [/^\/api\/reports\/(partners|partner-detail|analytics)$/, /^\/api\/last-prices$/, /^\/api\/attachments\//, /^\/api\/pdf\//, /^\/api\/costing\//];

  function strip(data) {
    if (Array.isArray(data)) return data.map(strip);
    if (data && typeof data === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(data)) if (!VALUE_KEYS.has(k)) out[k] = strip(v);
      return out;
    }
    return data;
  }
  const isValueOnlyPath = (p) => VALUE_ONLY_PATHS.some((re) => re.test(p));

  return { ROLES, WRITE_ROLES, canSeeValues, strip, isValueOnlyPath };
});
