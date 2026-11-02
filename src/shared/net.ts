export function effectivelyOffline(savedOffline: boolean, online: boolean): boolean {
  return savedOffline || !online
}
