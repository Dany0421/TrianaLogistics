document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();

  const backLink = document.querySelector('.back-link');
  if (backLink) backLink.addEventListener('click', () => { window.location.href = 'dashboard.html'; });

  document.getElementById('bomFileInput').addEventListener('change', function() { handleBomUpload(this); });
  document.getElementById('openManualBomBtn').addEventListener('click', openManualBomEntry);
  document.getElementById('loadBomFileBtn').addEventListener('click', () => document.getElementById('bomFileInput').click());
  document.getElementById('addSupplierBtn').addEventListener('click', openSupplierModal);
  document.getElementById('generateReportBtn').addEventListener('click', generateReport);
  document.getElementById('generateExcelBtn').addEventListener('click', generateExcel);
  document.getElementById('quotFileInput').addEventListener('change', function() { handleQuotationUpload(this); });
});
