/** "gid://shopify/Product/123" → "123". */
export function numericId(gid: string): string {
  return gid.split("/").pop() ?? gid;
}
