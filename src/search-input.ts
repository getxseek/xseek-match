export function splitSeasonInput(suffix: string, editing: boolean) {
  const match = suffix.match(/^S(\d{1,3})(?=$|E|\s)(.*)$/i);
  if (!match || (editing && !/^S\d{1,3}(?:E|\s)/i.test(suffix)))
    return { season: '', input: suffix };
  return { season: match[1]!, input: match[2]!.trimStart() };
}
