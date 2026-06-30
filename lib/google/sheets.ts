import { gfetch } from "./http";

function sheetLink(spreadsheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
}

export async function sheetsCreate(
  token: string,
  title: string,
  rows?: (string | number)[][],
): Promise<{ spreadsheetId: string; link: string }> {
  const created = await gfetch<{ spreadsheetId: string }>(
    token,
    "https://sheets.googleapis.com/v4/spreadsheets",
    { method: "POST", body: JSON.stringify({ properties: { title } }) },
  );
  const spreadsheetId = created.spreadsheetId;

  if (rows && rows.length) {
    await sheetsAppendRows(token, spreadsheetId, rows);
  }
  return { spreadsheetId, link: sheetLink(spreadsheetId) };
}

export async function sheetsAppendRows(
  token: string,
  spreadsheetId: string,
  rows: (string | number)[][],
  range = "Sheet1",
): Promise<{ spreadsheetId: string; link: string; updatedRows: number }> {
  const res = await gfetch<{ updates?: { updatedRows?: number } }>(
    token,
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
      range,
    )}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { method: "POST", body: JSON.stringify({ values: rows }) },
  );
  return {
    spreadsheetId,
    link: sheetLink(spreadsheetId),
    updatedRows: res.updates?.updatedRows ?? 0,
  };
}

export async function sheetsRead(
  token: string,
  spreadsheetId: string,
  range = "Sheet1",
): Promise<(string | number)[][]> {
  const res = await gfetch<{ values?: (string | number)[][] }>(
    token,
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
      range,
    )}`,
  );
  return res.values ?? [];
}
