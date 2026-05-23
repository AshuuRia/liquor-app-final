// Field specifications matching the Python script
export const FIELD_SPECS = [
  ["LIQUOR CODE", 0, 5],
  ["BRAND NAME", 5, 37],
  ["ADA NUMBER", 37, 40],
  ["ADA NAME", 40, 65],
  ["VENDOR NAME", 65, 90],
  ["PROOF", 110, 115],
  ["BOTTLE SIZE", 115, 122],
  ["PACK SIZE", 122, 125],
  ["ON PREMISE PRICE", 125, 136],
  ["OFF PREMISE PRICE", 136, 147],
  ["SHELF PRICE", 147, 158],
  ["UPC CODE 1", 158, 172],
  ["UPC CODE 2", 172, 186],
  ["EFFECTIVE DATE", 186, 194],
] as const;

export function parseLine(line: string) {
  const row: any = {};
  
  for (const [name, start, end] of FIELD_SPECS) {
    let value = line.slice(start, end).trim();
    
    // Handle price conversion
    if (name.includes("PRICE")) {
      try {
        const numValue = parseFloat(value.replace(/[$,]/g, ''));
        if (!isNaN(numValue)) {
          value = numValue as any;
        }
      } catch {
        // Keep original value if conversion fails
      }
    }
    // Handle date formatting MMDDYYYY to YYYY-MM-DD
    else if (name === "EFFECTIVE DATE" && value.length === 8) {
      value = `${value.slice(4)}-${value.slice(0, 2)}-${value.slice(2, 4)}`;
    }
    
    row[name.toLowerCase().replace(/ /g, "")] = value;
  }
  
  return {
    liquorCode: row.liquorcode || "",
    brandName: row.brandname || "",
    adaNumber: row.adanumber || "",
    adaName: row.adaname || "",
    vendorName: row.vendorname || "",
    proof: row.proof || "",
    bottleSize: row.bottlesize || "",
    packSize: row.packsize || "",
    onPremisePrice: row.onpremiseprice || 0,
    offPremisePrice: row.offpremiseprice || 0,
    shelfPrice: row.shelfprice || 0,
    upcCode1: row.upccode1 || "",
    upcCode2: row.upccode2 || "",
    effectiveDate: row.effectivedate || "",
  };
}

export function parseFileContent(content: string) {
  const lines = content.split('\n').filter(line => line.trim());
  const records = [];
  const brands = new Set();
  const vendors = new Set();
  const prices: number[] = [];

  for (const line of lines) {
    if (line.trim()) {
      const record = parseLine(line);
      records.push(record);
      
      if (record.brandName) brands.add(record.brandName);
      if (record.vendorName) vendors.add(record.vendorName);
      
      // Collect prices for average calculation
      if (typeof record.shelfPrice === 'number') {
        prices.push(record.shelfPrice);
      }
    }
  }

  const avgPrice = prices.length > 0 
    ? prices.reduce((sum, price) => sum + price, 0) / prices.length 
    : 0;

  return {
    success: true,
    totalRecords: records.length,
    uniqueBrands: brands.size,
    uniqueVendors: vendors.size,
    avgPrice: Number(avgPrice.toFixed(2)),
    records,
  };
}
