// Shared utilities used by both the Express dev server and the Cloudflare Pages Hono functions

export function normalizeUpc(upc: string | null | undefined): string {
  if (!upc) return '';
  return upc.replace(/^0+/, '') || '0';
}

export function parsePrice(value: string): number {
  const num = parseFloat(value.replace(/[$,]/g, '').trim());
  return isNaN(num) ? 0 : num;
}

// TSV column indices for the Michigan LARA Price Book format
export function parseTsvLine(line: string) {
  const cols = line.split('\t');
  return {
    liquorCode:      (cols[0]  || "").trim(),
    brandName:       (cols[1]  || "").trim(),
    adaNumber:       (cols[2]  || "").trim(),
    adaName:         (cols[3]  || "").trim(),
    vendorName:      (cols[4]  || "").trim(),
    proof:           (cols[6]  || "").trim(),
    bottleSize:      (cols[7]  || "").trim(),
    packSize:        (cols[8]  || "").trim(),
    onPremisePrice:  parsePrice(cols[11] || ""),
    offPremisePrice: parsePrice(cols[12] || ""),
    shelfPrice:      parsePrice(cols[13] || ""),
    upcCode1:        (cols[14] || "").trim(),
    upcCode2:        "",
    effectiveDate:   (cols[15] || "").trim(),
  };
}

// Convert a camera-decoded barcode back to what's printed on the bottle.
// Cameras often decode UPC-A (12 digits) as EAN-13 (13 digits, leading 0 added),
// or GTIN-14 (14 digits, two leading zeros). Strip the extra prefix.
export function toBottleBarcode(barcode: string): string {
  if (/^\d+$/.test(barcode)) {
    if (barcode.length === 14 && barcode.startsWith('00')) return barcode.slice(2);
    if (barcode.length === 13 && barcode.startsWith('0'))  return barcode.slice(1);
  }
  return barcode;
}

// Generate HTML for Brother QL printer labels
export function generateLabelHTML(items: any[]): string {
  const labelCSS = `
    <style>
      @page { size: 2.4in 1.2in; margin: 0; }
      @media print {
        body { margin: 0; padding: 0; font-family: Arial, sans-serif; }
        .label {
          width: 2.4in; height: 1.2in; padding: 0.05in;
          border: 1px solid #000; box-sizing: border-box;
          page-break-after: always; display: flex;
          flex-direction: column; position: relative;
        }
        .label:last-child { page-break-after: avoid; }
        .label-header { font-weight: bold; font-size: 11px; text-align: center; line-height: 1.1; margin-bottom: 0.02in; }
        .label-body { flex: 1; display: flex; align-items: center; justify-content: space-between; }
        .barcode-section { flex: 1; display: flex; align-items: center; }
        .barcode { font-family: 'Libre Barcode 128', monospace; font-size: 20px; letter-spacing: 0; line-height: 1; writing-mode: horizontal-tb; }
        .price-section { font-weight: bold; font-size: 16px; text-align: right; margin-left: 0.1in; }
        .label-footer { position: absolute; bottom: 0.05in; right: 0.05in; font-size: 8px; font-weight: bold; }
        .no-print { display: none !important; }
      }
      @media screen {
        body { font-family: Arial, sans-serif; padding: 20px; background: #f0f0f0; }
        .print-instructions { background: #e3f2fd; border: 1px solid #1976d2; border-radius: 4px; padding: 15px; margin-bottom: 20px; }
        .label {
          width: 240px; height: 120px; padding: 5px;
          border: 2px solid #000; box-sizing: border-box;
          margin: 10px; display: inline-flex;
          flex-direction: column; position: relative; background: white;
        }
        .label-header { font-weight: bold; font-size: 11px; text-align: center; line-height: 1.1; margin-bottom: 2px; }
        .label-body { flex: 1; display: flex; align-items: center; justify-content: space-between; }
        .barcode-section { flex: 1; display: flex; align-items: center; }
        .barcode { font-family: monospace; font-size: 8px; letter-spacing: 1px; line-height: 1; background: repeating-linear-gradient(90deg, #000 0px, #000 1px, #fff 1px, #fff 2px); color: transparent; padding: 5px 0; }
        .price-section { font-weight: bold; font-size: 16px; text-align: right; margin-left: 10px; }
        .label-footer { position: absolute; bottom: 5px; right: 5px; font-size: 8px; font-weight: bold; }
      }
    </style>
  `;

  const labelElements = items.map((item: any) => {
    const product = item.product;
    const brandWithSize = `${product.brandName} ${product.bottleSize}`;
    const price = typeof product.shelfPrice === 'number' ? `$${product.shelfPrice.toFixed(2)}` : product.shelfPrice;
    const barcode = item.scannedBarcode || product.upcCode1 || '';
    return `
      <div class="label">
        <div class="label-header">${brandWithSize}</div>
        <div class="label-body">
          <div class="barcode-section"><div class="barcode">${barcode}</div></div>
          <div class="price-section">${price}</div>
        </div>
        <div class="label-footer">${product.liquorCode}</div>
      </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Liquor Shelf Labels</title>
  ${labelCSS}
  <link href="https://fonts.googleapis.com/css2?family=Libre+Barcode+128&display=swap" rel="stylesheet">
</head>
<body>
  <div class="print-instructions no-print">
    <h3>🏷️ Brother QL-820NWB Label Printing Instructions</h3>
    <ol>
      <li>Load 2.4" x 1.2" continuous length labels in your Brother QL-820NWB</li>
      <li>In your browser, go to <strong>File → Print</strong> (or Ctrl+P)</li>
      <li>Select your Brother QL-820NWB printer</li>
      <li>Choose <strong>More settings → Paper size → 2.4" x 1.2"</strong></li>
      <li>Set <strong>Margins to None</strong> and <strong>Scale to 100%</strong></li>
      <li>Click Print - labels will auto-cut between each item</li>
    </ol>
    <p><strong>Total labels to print: ${items.length}</strong></p>
  </div>
  ${labelElements}
</body>
</html>`;
}
