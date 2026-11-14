const FIELDS = ['utcDate', 'status', 'homeGoals', 'awayGoals', 'source', 'homeName', 'awayName'];

export function buildMatchQuery(selected, flags) {
  const core = FIELDS.filter((field) => selected.includes(field)).join('\n    ');
  return `query Built($first: Int!, $after: String, $withPlayers: Boolean!, $skipVenue: Boolean!) {
  matches(first: $first, after: $after, sort: [{ field: "DATE", direction: "DESC" }]) {
    totalCount
    pageInfo { hasNextPage endCursor }
    edges {
      node {
        ...MatchCore
        home: homeTeam {
          name
          country
          stadium @skip(if: $skipVenue) { name city }
          players @include(if: $withPlayers) { name position }
        }
        awayTeam { name }
      }
    }
  }
}
fragment MatchCore on Match {
  id
  ${core}
}`;
}

export function builderState(form) {
  const selected = [...form.querySelectorAll('input[name=field]:checked')].map((input) => input.value);
  const flags = {
    withPlayers: form.querySelector('[name=withPlayers]').checked,
    skipVenue: form.querySelector('[name=skipVenue]').checked,
  };
  return { query: buildMatchQuery(selected, flags), variables: { first: 2, after: null, ...flags } };
}

export { FIELDS };
