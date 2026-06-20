export async function getThirdPartyNoticesText(): Promise<string> {
  const noticeModule = await import("../../THIRD-PARTY-NOTICES.txt?raw");

  return noticeModule.default;
}
