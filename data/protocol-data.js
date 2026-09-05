const teams = [
  {
    id: 1,
    name: 'Локомотив',
    shortName: 'Локомотив',
    city: 'Ярославль',
    primaryColor: '#C8102E',
    secondaryColor: '#1A1A1A'
  },
  {
    id: 2,
    name: 'Трактор',
    shortName: 'Трактор',
    city: 'Челябинск',
    primaryColor: '#000000',
    secondaryColor: '#FFFFFF'
  },
  {
    id: 3,
    name: 'Автомобилист',
    shortName: 'Автомобилист',
    city: 'Екатеринбург',
    primaryColor: '#E31B23',
    secondaryColor: '#FFFFFF'
  },
  {
    id: 4,
    name: 'Динамо Москва',
    shortName: 'Динамо М',
    city: 'Москва',
    primaryColor: '#0047AB',
    secondaryColor: '#FFFFFF'
  },
  {
    id: 5,
    name: 'Спартак',
    shortName: 'Спартак',
    city: 'Москва',
    primaryColor: '#D71920',
    secondaryColor: '#FFFFFF'
  },
  {
    id: 6,
    name: 'Торпедо',
    shortName: 'Торпедо',
    city: 'Нижний Новгород',
    primaryColor: '#1B2A72',
    secondaryColor: '#FFFFFF'
  },
  {
    id: 7,
    name: 'Северсталь',
    shortName: 'Северсталь',
    city: 'Череповец',
    primaryColor: '#FFD400',
    secondaryColor: '#1A1A1A'
  },
  {
    id: 8,
    name: 'Салават Юлаев',
    shortName: 'Салават Юлаев',
    city: 'Уфа',
    primaryColor: '#00843D',
    secondaryColor: '#FFD400'
  },
  {
    id: 9,
    name: 'СКА',
    shortName: 'СКА',
    city: 'Санкт-Петербург',
    primaryColor: '#003DA5',
    secondaryColor: '#E31B23'
  },
  {
    id: 10,
    name: 'Лада',
    shortName: 'Лада',
    city: 'Тольятти',
    primaryColor: '#003F7F',
    secondaryColor: '#FFFFFF'
  },
  {
    id: 11,
    name: 'Ак Барс',
    shortName: 'Ак Барс',
    city: 'Казань',
    primaryColor: '#00563F',
    secondaryColor: '#E31B23'
  },
  {
    id: 12,
    name: 'Сибирь',
    shortName: 'Сибирь',
    city: 'Новосибирск',
    primaryColor: '#002B5C',
    secondaryColor: '#FFFFFF'
  },
  {
    id: 13,
    name: 'Металлург Магнитогорск',
    shortName: 'Металлург Мг',
    city: 'Магнитогорск',
    primaryColor: '#003B70',
    secondaryColor: '#F58220'
  },
  {
    id: 14,
    name: 'Амур',
    shortName: 'Амур',
    city: 'Хабаровск',
    primaryColor: '#F15A24',
    secondaryColor: '#1A1A1A'
  },
  {
    id: 15,
    name: 'Нефтехимик',
    shortName: 'Нефтехимик',
    city: 'Нижнекамск',
    primaryColor: '#003B70',
    secondaryColor: '#FFFFFF'
  },
  {
    id: 16,
    name: 'Шанхай Дрэгонс',
    shortName: 'Драконы',
    city: 'Шанхай',
    primaryColor: '#F15A24',
    secondaryColor: '#FFFFFF'
  },
  {
    id: 17,
    name: 'Авангард',
    shortName: 'Авангард',
    city: 'Омск',
    primaryColor: '#D71920',
    secondaryColor: '#1A1A1A'
  },
  {
    id: 18,
    name: 'Барыс',
    shortName: 'Барыс',
    city: 'Астана',
    primaryColor: '#00A6C8',
    secondaryColor: '#003B70'
  },
  {
    id: 19,
    name: 'Динамо Минск',
    shortName: 'Динамо Мн',
    city: 'Минск',
    primaryColor: '#48BCE7',
    secondaryColor: '#1E22AA'
  },
  {
    id: 20,
    name: 'ЦСКА',
    shortName: 'ЦСКА',
    city: 'Москва',
    primaryColor: '#E31B23',
    secondaryColor: '#003DA5'
  }
];

const venues = [
  {
    id: 1,
    name: 'Арена-2000',
    city: 'Ярославль'
  },
  {
    id: 2,
    name: 'УГМК Арена',
    city: 'Екатеринбург'
  },
  {
    id: 3,
    name: 'Мегаспорт',
    city: 'Москва'
  },
  {
    id: 4,
    name: 'Ледовый дворец',
    city: 'Санкт-Петербург'
  },
  {
    id: 5,
    name: 'Ледовый дворец',
    city: 'Череповец'
  },
  {
    id: 6,
    name: 'Татнефть Арена',
    city: 'Казань'
  },
  {
    id: 7,
    name: 'Арена-Металлург',
    city: 'Магнитогорск'
  },
  {
    id: 8,
    name: 'Нефтехим Арена',
    city: 'Нижнекамск'
  },
  {
    id: 9,
    name: 'G-Drive Арена',
    city: 'Омск'
  },
  {
    id: 10,
    name: 'Барыс Арена',
    city: 'Астана'
  },
  {
    id: 11,
    name: 'Минск-Арена',
    city: 'Минск'
  },
  {
    id: 12,
    name: 'ЦСКА Арена',
    city: 'Москва'
  }
];

const matches = [
  {
    id: 1,
    homeTeamId: 1,
    awayTeamId: 2,
    venueId: 1,
    dateTime: '2026-09-05T13:00',
    status: 'Запланирован',
    homeGoals: null,
    awayGoals: null,
    attachment: null
  },
  {
    id: 2,
    homeTeamId: 3,
    awayTeamId: 4,
    venueId: 2,
    dateTime: '2026-09-05T14:30',
    status: 'Запланирован',
    homeGoals: null,
    awayGoals: null,
    attachment: null
  },
  {
    id: 3,
    homeTeamId: 5,
    awayTeamId: 6,
    venueId: 3,
    dateTime: '2026-09-05T17:00',
    status: 'Запланирован',
    homeGoals: null,
    awayGoals: null,
    attachment: null
  },
  {
    id: 4,
    homeTeamId: 7,
    awayTeamId: 8,
    venueId: 5,
    dateTime: '2026-09-05T17:00',
    status: 'Запланирован',
    homeGoals: null,
    awayGoals: null,
    attachment: null
  },
  {
    id: 5,
    homeTeamId: 9,
    awayTeamId: 10,
    venueId: 4,
    dateTime: '2026-09-05T17:00',
    status: 'Запланирован',
    homeGoals: null,
    awayGoals: null,
    attachment: null
  },
  {
    id: 6,
    homeTeamId: 11,
    awayTeamId: 12,
    venueId: 6,
    dateTime: '2026-09-05T17:00',
    status: 'Запланирован',
    homeGoals: null,
    awayGoals: null,
    attachment: null
  },
  {
    id: 7,
    homeTeamId: 13,
    awayTeamId: 14,
    venueId: 7,
    dateTime: '2026-09-06T14:30',
    status: 'Запланирован',
    homeGoals: null,
    awayGoals: null,
    attachment: null
  },
  {
    id: 8,
    homeTeamId: 15,
    awayTeamId: 16,
    venueId: 8,
    dateTime: '2026-09-06T17:00',
    status: 'Запланирован',
    homeGoals: null,
    awayGoals: null,
    attachment: null
  },
  {
    id: 9,
    homeTeamId: 17,
    awayTeamId: 8,
    venueId: 9,
    dateTime: '2026-09-07T16:30',
    status: 'Запланирован',
    homeGoals: null,
    awayGoals: null,
    attachment: null
  },
  {
    id: 10,
    homeTeamId: 3,
    awayTeamId: 2,
    venueId: 2,
    dateTime: '2026-09-07T17:00',
    status: 'Запланирован',
    homeGoals: null,
    awayGoals: null,
    attachment: null
  },
  {
    id: 11,
    homeTeamId: 18,
    awayTeamId: 12,
    venueId: 10,
    dateTime: '2026-09-07T17:00',
    status: 'Запланирован',
    homeGoals: null,
    awayGoals: null,
    attachment: null
  },
  {
    id: 12,
    homeTeamId: 7,
    awayTeamId: 10,
    venueId: 5,
    dateTime: '2026-09-07T19:00',
    status: 'Запланирован',
    homeGoals: null,
    awayGoals: null,
    attachment: null
  },
  {
    id: 13,
    homeTeamId: 19,
    awayTeamId: 6,
    venueId: 11,
    dateTime: '2026-09-07T19:10',
    status: 'Запланирован',
    homeGoals: null,
    awayGoals: null,
    attachment: null
  },
  {
    id: 14,
    homeTeamId: 20,
    awayTeamId: 5,
    venueId: 12,
    dateTime: '2026-09-07T19:30',
    status: 'Запланирован',
    homeGoals: null,
    awayGoals: null,
    attachment: null
  },
  {
    id: 15,
    homeTeamId: 9,
    awayTeamId: 4,
    venueId: 4,
    dateTime: '2026-09-07T19:30',
    status: 'Запланирован',
    homeGoals: null,
    awayGoals: null,
    attachment: null
  }
];

module.exports = {
  teams,
  venues,
  matches
};