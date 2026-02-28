/**
 * Google Apps Script for ScanStock
 * 
 * Instructions:
 * 1. Open a Google Sheet.
 * 2. Go to Extensions > Apps Script.
 * 3. Paste this code.
 * 4. Deploy as Web App (Execute as: Me, Who has access: Anyone).
 * 5. Copy the Web App URL and set it in the ScanStock app settings.
 */

function doGet(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const data = sheet.getDataRange().getValues();
  const headers = data.shift();
  
  const result = data.map(row => {
    const obj = {};
    headers.forEach((header, i) => {
      obj[header] = row[i];
    });
    return obj;
  });
  
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const params = JSON.parse(e.postData.contents);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  
  if (params.action === 'add_item') {
    sheet.appendRow([
      params.barcode,
      params.name,
      params.category,
      params.price,
      params.stock,
      new Date()
    ]);
  } else if (params.action === 'record_sale') {
    // Logic to find item and update stock would go here
    // For simplicity, we'll just log the sale in a "Sales" sheet
    let salesSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Sales");
    if (!salesSheet) {
      salesSheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet("Sales");
      salesSheet.appendRow(["Barcode", "Quantity", "Total Price", "Date"]);
    }
    salesSheet.appendRow([
      params.barcode,
      params.quantity,
      params.totalPrice,
      new Date()
    ]);
  }
  
  return ContentService.createTextOutput(JSON.stringify({ success: true }))
    .setMimeType(ContentService.MimeType.JSON);
}
