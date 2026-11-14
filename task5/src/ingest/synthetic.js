import { faker } from '@faker-js/faker';

const POSITIONS = ['GK', 'DF', 'MF', 'FW'];

export function syntheticPlayers(team, count = 3) {
  faker.seed(Number(team.id) * 17 + 3);
  return Array.from({ length: count }, (_, index) => ({
    name: faker.person.fullName(),
    position: POSITIONS[index % POSITIONS.length],
    nationality: faker.location.country(),
    birth: faker.date.birthdate({ min: 18, max: 36, mode: 'age' }).toISOString().slice(0, 10),
    source: 'synthetic',
  }));
}

export function syntheticStadium(team) {
  faker.seed(Number(team.id) * 13 + 9);
  return {
    name: `${team.name} Arena`,
    city: faker.location.city(),
    country: team.country || 'World',
    capacity: faker.number.int({ min: 6000, max: 80000 }),
    source: 'synthetic',
  };
}
