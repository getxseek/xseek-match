const nativeFetch = globalThis.fetch;
// The suite owns fixtures: never refresh real tracker metadata during tests.
globalThis.fetch = async (input, options) => {
  if (
    String(input).startsWith(
      'https://raw.githubusercontent.com/fHori/Private-Trackers-Spreadsheet/',
    )
  )
    return Response.json({ trackers: [{ Name: 'Fixture', Abbreviation: 'FX' }] });
  if (String(input).startsWith('https://thexem.info/'))
    return Response.json({ result: 'success', data: [] });
  return nativeFetch(input, options);
};
