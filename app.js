const express = require('express');
const path = require('path');
const multer = require('multer');

const { teams, venues, matches } = require('./data/protocol-data');

const app = express();
const PORT = 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, 'uploads'));
  },
  filename: (req, file, cb) => {
    const safeFileName = file.originalname.replace(/\s+/g, '-');
    cb(null, `${Date.now()}-${safeFileName}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024
  }
});

function parseGoals(value) {
  if (value === '') {
    return null;
  }

  const goals = Number(value);

  if (!Number.isInteger(goals) || goals < 0) {
    return undefined;
  }

  return goals;
}

function isValidStatus(status) {
  return ['Ожидается', 'Идёт 1-ый период', "Первый перерыв", 'Идёт 2-ой период', "Второй перерыв", 'Идёт 3-й период', 'Завершён', "Отменён"].includes(status);
}

app.post('/matches', upload.single('attachment'), (req, res) => {
  const homeTeamId = Number(req.body.homeTeamId);
  const awayTeamId = Number(req.body.awayTeamId);
  const venueId = Number(req.body.venueId);

  const homeGoals = parseGoals(req.body.homeGoals);
  const awayGoals = parseGoals(req.body.awayGoals);

  const homeTeamExists = teams.some((team) => team.id === homeTeamId);
  const awayTeamExists = teams.some((team) => team.id === awayTeamId);
  const venueExists = venues.some((venue) => venue.id === venueId);

  if (
    !homeTeamExists ||
    !awayTeamExists ||
    !venueExists ||
    homeTeamId === awayTeamId ||
    !req.body.dateTime ||
    !isValidStatus(req.body.status)
  ) {
    return res.status(400).send('Проверьте корректность заполнения формы.');
  }

  if (homeGoals === undefined || awayGoals === undefined) {
    return res.status(400).send(
      'Количество голов должно быть целым неотрицательным числом.'
    );
  }

  if (
    req.body.status === 'Завершён' &&
    (homeGoals === null || awayGoals === null)
  ) {
    return res.status(400).send(
      'Для завершённого матча необходимо указать голы обеих команд.'
    );
  }

  const newMatch = {
    id: Date.now(),
    homeTeamId,
    awayTeamId,
    venueId,
    dateTime: req.body.dateTime,
    status: req.body.status,
    homeGoals,
    awayGoals,
    attachment: req.file ? req.file.filename : null
  };

  matches.push(newMatch);

  res.redirect('/');
});

function getMatchView(match) {
  const homeTeam = teams.find((team) => team.id === match.homeTeamId);
  const awayTeam = teams.find((team) => team.id === match.awayTeamId);
  const venue = venues.find((venue) => venue.id === match.venueId);

  if (!homeTeam || !awayTeam || !venue) {
    console.error('Ошибка связей в матче:', {
      matchId: match.id,
      homeTeamId: match.homeTeamId,
      awayTeamId: match.awayTeamId,
      venueId: match.venueId,
      homeTeamFound: Boolean(homeTeam),
      awayTeamFound: Boolean(awayTeam),
      venueFound: Boolean(venue)
    });

    return null;
  }

  return {
    ...match,
    homeTeam,
    awayTeam,
    venue
  };
}

app.get('/', (req, res) => {
  const selectedStatus = req.query.status || 'Все';

  const filteredMatches = matches
    .filter((match) => {
      return selectedStatus === 'Все' || match.status === selectedStatus;
    })
    .map(getMatchView)
    .filter(Boolean)
    .sort((firstMatch, secondMatch) => {
      return new Date(firstMatch.dateTime) - new Date(secondMatch.dateTime);
    });

  res.render('index', {
    title: 'Протокол — хоккейные матчи',
    matches: filteredMatches,
    selectedStatus
  });
});

app.get('/matches/new', (req, res) => {
  res.render('add-match', {
    title: 'Протокол — добавить матч',
    teams,
    venues
  });
});

app.get('/matches/:id/edit', (req, res) => {
  const matchId = Number(req.params.id);

  const match = matches.find((item) => item.id === matchId);

  if (!match) {
    return res.status(404).send('Матч не найден.');
  }

  const matchView = getMatchView(match);

  if (!matchView) {
    return res.status(500).send(
      'Не удалось получить связанные данные матча: команду или арену.'
    );
  }

  res.render('edit-match', {
    title: 'Протокол — редактирование матча',
    match: matchView
  });
});

app.post('/matches/:id/update', (req, res) => {
  const match = matches.find((item) => item.id === Number(req.params.id));

  if (!match) {
    return res.status(404).send('Матч не найден.');
  }

  const homeGoals = parseGoals(req.body.homeGoals);
  const awayGoals = parseGoals(req.body.awayGoals);

  if (!isValidStatus(req.body.status)) {
    return res.status(400).send('Выбран недопустимый статус.');
  }

  if (homeGoals === undefined || awayGoals === undefined) {
    return res.status(400).send(
      'Количество голов должно быть целым неотрицательным числом.'
    );
  }

  if (
    req.body.status === 'Завершён' &&
    (homeGoals === null || awayGoals === null)
  ) {
    return res.status(400).send(
      'Для завершённого матча необходимо указать голы обеих команд.'
    );
  }

  match.status = req.body.status;
  match.homeGoals = homeGoals;
  match.awayGoals = awayGoals;

  res.redirect('/');
});

app.post(
  '/matches/:id/attachment',
  upload.single('attachment'),
  (req, res) => {
    const match = matches.find((item) => item.id === Number(req.params.id));

    if (!match) {
      return res.status(404).send('Матч не найден.');
    }

    if (!req.file) {
      return res.status(400).send('Выберите файл для загрузки.');
    }

    match.attachment = req.file.filename;

    res.redirect(`/matches/${match.id}/edit`);
  }
);

app.listen(PORT, () => {
  console.log(`Протокол запущен: http://localhost:${PORT}`);
});

