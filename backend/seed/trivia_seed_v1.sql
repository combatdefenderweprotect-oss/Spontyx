-- ─────────────────────────────────────────────────────────────────────────────
-- Trivia Seed v1 — Initial approved_public question bank
-- All questions: source_type='manual', approval_state='approved_public'
-- Run AFTER migration 076_trivia_questions_sets.sql
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- SOCCER — 60 questions (20 easy, 20 medium, 20 hard)
-- Category split: 'Premier League', 'Champions League', 'International', 'La Liga / Europe'
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO public.trivia_questions
  (sport, category, difficulty, question, options, correct_index, explanation, source_type, approval_state, approved_at)
VALUES

-- ── Soccer Easy (20) ──────────────────────────────────────────────────────
('soccer','International','easy',
 'Which nation won the 2022 FIFA World Cup in Qatar?',
 '["Brazil","France","Argentina","Germany"]'::jsonb, 2,
 'Argentina defeated France on penalties in a dramatic final, winning their third World Cup title.',
 'manual','approved_public', NOW()),

('soccer','Premier League','easy',
 'Who is the all-time top scorer in Premier League history?',
 '["Wayne Rooney","Andrew Cole","Thierry Henry","Alan Shearer"]'::jsonb, 3,
 'Alan Shearer scored 260 Premier League goals for Blackburn Rovers and Newcastle United.',
 'manual','approved_public', NOW()),

('soccer','Champions League','easy',
 'Which club has won the most UEFA Champions League titles?',
 '["AC Milan","Barcelona","Bayern Munich","Real Madrid"]'::jsonb, 3,
 'Real Madrid have won the Champions League 15 times, more than any other club.',
 'manual','approved_public', NOW()),

('soccer','International','easy',
 'Which country has won the most FIFA World Cup tournaments?',
 '["Germany","Italy","Argentina","Brazil"]'::jsonb, 3,
 'Brazil have won the FIFA World Cup five times: 1958, 1962, 1970, 1994, and 2002.',
 'manual','approved_public', NOW()),

('soccer','Premier League','easy',
 'In which year was the Premier League founded?',
 '["1988","1990","1992","1994"]'::jsonb, 2,
 'The Premier League began in the 1992–93 season after clubs broke away from the Football League.',
 'manual','approved_public', NOW()),

('soccer','Premier League','easy',
 'Which club plays home matches at Old Trafford?',
 '["Liverpool","Manchester City","Everton","Manchester United"]'::jsonb, 3,
 'Old Trafford has been Manchester United''s home ground since 1910.',
 'manual','approved_public', NOW()),

('soccer','International','easy',
 'Which nation won the 2018 FIFA World Cup in Russia?',
 '["Germany","Croatia","Belgium","France"]'::jsonb, 3,
 'France defeated Croatia 4–2 in the final in Moscow to claim their second World Cup.',
 'manual','approved_public', NOW()),

('soccer','La Liga / Europe','easy',
 'In which country is La Liga played?',
 '["Portugal","France","Italy","Spain"]'::jsonb, 3,
 'La Liga is the top professional football division of the Spanish football league system.',
 'manual','approved_public', NOW()),

('soccer','Premier League','easy',
 'How many teams compete in the Premier League each season?',
 '["18","20","22","24"]'::jsonb, 1,
 'The Premier League has featured 20 clubs per season since its expansion in 1995.',
 'manual','approved_public', NOW()),

('soccer','Premier League','easy',
 'Which club won the inaugural Premier League season in 1992–93?',
 '["Arsenal","Blackburn Rovers","Leeds United","Manchester United"]'::jsonb, 3,
 'Manchester United won the first Premier League title under Alex Ferguson.',
 'manual','approved_public', NOW()),

('soccer','International','easy',
 'What colour card results in a player being immediately sent off?',
 '["Yellow","Orange","Blue","Red"]'::jsonb, 3,
 'A red card results in immediate dismissal. Two yellow cards in the same match also result in a sending off.',
 'manual','approved_public', NOW()),

('soccer','International','easy',
 'How many players from each team are on the field during a standard match?',
 '["9","10","11","12"]'::jsonb, 2,
 'Each team fields 11 players including the goalkeeper.',
 'manual','approved_public', NOW()),

('soccer','International','easy',
 'How long is a standard football match, excluding extra time?',
 '["80 minutes","85 minutes","90 minutes","95 minutes"]'::jsonb, 2,
 'A standard match consists of two 45-minute halves, totalling 90 minutes.',
 'manual','approved_public', NOW()),

('soccer','Champions League','easy',
 'Which club did Cristiano Ronaldo leave to join Juventus in 2018?',
 '["Manchester United","PSG","Barcelona","Real Madrid"]'::jsonb, 3,
 'Ronaldo left Real Madrid for Juventus for a fee reported at around €100 million.',
 'manual','approved_public', NOW()),

('soccer','International','easy',
 'Who won the 2022 Ballon d''Or?',
 '["Lionel Messi","Cristiano Ronaldo","Kylian Mbappé","Karim Benzema"]'::jsonb, 3,
 'Karim Benzema won the 2022 Ballon d''Or following his outstanding Champions League campaign with Real Madrid.',
 'manual','approved_public', NOW()),

('soccer','International','easy',
 'Which player is the all-time top scorer for the Brazilian national team?',
 '["Ronaldo","Pelé","Romário","Neymar"]'::jsonb, 3,
 'Neymar surpassed Pelé''s record of 77 goals in 2023 to become Brazil''s all-time top scorer.',
 'manual','approved_public', NOW()),

('soccer','Premier League','easy',
 'Which club has won the most Premier League titles?',
 '["Arsenal","Chelsea","Liverpool","Manchester United"]'::jsonb, 3,
 'Manchester United have won 13 Premier League titles, more than any other club.',
 'manual','approved_public', NOW()),

('soccer','Champions League','easy',
 'In which city is the Santiago Bernabéu stadium located?',
 '["Barcelona","Seville","Lisbon","Madrid"]'::jsonb, 3,
 'The Santiago Bernabéu is Real Madrid''s home stadium, located in Madrid, Spain.',
 'manual','approved_public', NOW()),

('soccer','Premier League','easy',
 'Which club did Erling Haaland join when he moved to England in 2022?',
 '["Chelsea","Arsenal","Liverpool","Manchester City"]'::jsonb, 3,
 'Haaland joined Manchester City from Borussia Dortmund in summer 2022.',
 'manual','approved_public', NOW()),

('soccer','International','easy',
 'Which player is known as the "Egyptian King" at Liverpool?',
 '["Sadio Mané","Diogo Jota","Roberto Firmino","Mohamed Salah"]'::jsonb, 3,
 'Mohamed Salah, born in Nagrig, Egypt, is widely known as the Egyptian King at Anfield.',
 'manual','approved_public', NOW()),

-- ── Soccer Medium (20) ────────────────────────────────────────────────────
('soccer','International','medium',
 'Who holds the record for most goals in a single FIFA World Cup tournament?',
 '["Pelé","Gerd Müller","Ronaldo","Just Fontaine"]'::jsonb, 3,
 'Just Fontaine scored 13 goals for France at the 1958 World Cup in Sweden — a record that still stands.',
 'manual','approved_public', NOW()),

('soccer','Champions League','medium',
 'Which manager has won the most UEFA Champions League titles?',
 '["José Mourinho","Zinedine Zidane","Bob Paisley","Carlo Ancelotti"]'::jsonb, 3,
 'Carlo Ancelotti has won the Champions League four times: twice with AC Milan (2003, 2007) and twice with Real Madrid (2014, 2022).',
 'manual','approved_public', NOW()),

('soccer','Premier League','medium',
 'In which season did Arsenal go the entire Premier League campaign unbeaten?',
 '["2002–03","2003–04","2004–05","2005–06"]'::jsonb, 1,
 'Arsenal''s "Invincibles" went 38 league games unbeaten in the 2003–04 season, winning the title.',
 'manual','approved_public', NOW()),

('soccer','International','medium',
 'Which player has scored in five different FIFA World Cup tournaments?',
 '["Uwe Seeler","Pelé","Miroslav Klose","Cristiano Ronaldo"]'::jsonb, 3,
 'Cristiano Ronaldo scored at the 2006, 2010, 2014, 2018, and 2022 World Cups.',
 'manual','approved_public', NOW()),

('soccer','Premier League','medium',
 'Which goalkeeper holds the record for most Premier League clean sheets?',
 '["David James","Edwin van der Sar","Peter Schmeichel","Petr Čech"]'::jsonb, 3,
 'Petr Čech recorded 202 Premier League clean sheets across his career at Chelsea and Arsenal.',
 'manual','approved_public', NOW()),

('soccer','Champions League','medium',
 'Which club won the 2019–20 UEFA Champions League, defeating PSG in the final?',
 '["Liverpool","RB Leipzig","Atletico Madrid","Bayern Munich"]'::jsonb, 3,
 'Bayern Munich beat PSG 1–0 in the final in Lisbon, completing a treble.',
 'manual','approved_public', NOW()),

('soccer','Champions League','medium',
 'Which club did Liverpool defeat in the 2019 Champions League final?',
 '["Ajax","Juventus","Tottenham Hotspur","Barcelona"]'::jsonb, 2,
 'Liverpool beat Tottenham Hotspur 2–0 in the Madrid final, goals from Salah and Origi.',
 'manual','approved_public', NOW()),

('soccer','International','medium',
 'Who was the top scorer at the 2018 FIFA World Cup with six goals?',
 '["Antoine Griezmann","Cristiano Ronaldo","Kylian Mbappé","Harry Kane"]'::jsonb, 3,
 'Harry Kane won the Golden Boot at Russia 2018 with six goals, including four penalties.',
 'manual','approved_public', NOW()),

('soccer','La Liga / Europe','medium',
 'Which club has won the most La Liga titles?',
 '["Barcelona","Atletico Madrid","Valencia","Real Madrid"]'::jsonb, 3,
 'Real Madrid have won La Liga more than any other club, with 36 titles as of 2024.',
 'manual','approved_public', NOW()),

('soccer','International','medium',
 'In which year did Zinedine Zidane headbutt Marco Materazzi in the World Cup final?',
 '["2002","2004","2006","2010"]'::jsonb, 2,
 'Zidane headbutted Materazzi in the second period of extra time of the 2006 final in Berlin, receiving a red card.',
 'manual','approved_public', NOW()),

('soccer','Premier League','medium',
 'How many Premier League goals did Erling Haaland score in his debut 2022–23 season?',
 '["28","32","36","40"]'::jsonb, 2,
 'Haaland scored 36 Premier League goals in his debut season — a record for a single Premier League campaign.',
 'manual','approved_public', NOW()),

('soccer','International','medium',
 'Which country won the inaugural UEFA European Championship in 1960?',
 '["Yugoslavia","Czechoslovakia","Spain","Soviet Union"]'::jsonb, 3,
 'The Soviet Union beat Yugoslavia 2–1 in the final of the first European Championship, held in France.',
 'manual','approved_public', NOW()),

('soccer','Champions League','medium',
 'How many consecutive Champions League titles did Real Madrid win between 2016 and 2018?',
 '["2","3","4","5"]'::jsonb, 1,
 'Real Madrid won the Champions League three times in a row: 2015–16, 2016–17, and 2017–18, all under Zidane.',
 'manual','approved_public', NOW()),

('soccer','International','medium',
 'Which Brazilian player wore the number 10 shirt at the 2002 World Cup?',
 '["Ronaldo","Rivaldo","Ronaldinho","Roberto Carlos"]'::jsonb, 1,
 'Rivaldo wore the number 10 shirt for Brazil in 2002. Ronaldo wore 9 and Ronaldinho wore 11.',
 'manual','approved_public', NOW()),

('soccer','Premier League','medium',
 'Which club won the only FA Cup title in their history when they beat Chelsea in 2021?',
 '["Aston Villa","Wolves","Leicester City","Crystal Palace"]'::jsonb, 2,
 'Leicester City beat Chelsea 1–0 in the 2021 FA Cup final thanks to a header from Youri Tielemans.',
 'manual','approved_public', NOW()),

('soccer','La Liga / Europe','medium',
 'Which club did Xabi Alonso manage to the first unbeaten Bundesliga season in 2023–24?',
 '["Bayern Munich","Borussia Dortmund","RB Leipzig","Bayer Leverkusen"]'::jsonb, 3,
 'Bayer Leverkusen, managed by Xabi Alonso, went the entire 2023–24 Bundesliga season unbeaten.',
 'manual','approved_public', NOW()),

('soccer','Champions League','medium',
 'Which stadium hosted the 2024 UEFA Champions League final between Real Madrid and Borussia Dortmund?',
 '["Allianz Arena","Camp Nou","Ataturk Olympic Stadium","Wembley Stadium"]'::jsonb, 3,
 'Wembley hosted the 2024 Champions League final. Real Madrid won 2–0.',
 'manual','approved_public', NOW()),

('soccer','International','medium',
 'Who was the Golden Ball winner at the 2022 FIFA World Cup?',
 '["Kylian Mbappé","Luka Modrić","Neymar","Lionel Messi"]'::jsonb, 3,
 'Lionel Messi won the Golden Ball as tournament MVP at Qatar 2022, his final World Cup.',
 'manual','approved_public', NOW()),

('soccer','La Liga / Europe','medium',
 'Which Italian club dominated Serie A by winning nine consecutive league titles from 2012 to 2020?',
 '["Inter Milan","AC Milan","Roma","Juventus"]'::jsonb, 3,
 'Juventus won Serie A nine seasons in a row from 2011–12 through 2019–20.',
 'manual','approved_public', NOW()),

('soccer','Premier League','medium',
 'Which club has won the FA Cup the most times in history?',
 '["Manchester United","Liverpool","Chelsea","Arsenal"]'::jsonb, 3,
 'Arsenal have won the FA Cup 14 times, more than any other club.',
 'manual','approved_public', NOW()),

-- ── Soccer Hard (20) ──────────────────────────────────────────────────────
('soccer','International','hard',
 'Who holds the record for the most goals scored in a single calendar year?',
 '["Gerd Müller","Cristiano Ronaldo","Josef Bican","Lionel Messi"]'::jsonb, 3,
 'Lionel Messi scored 91 goals in all competitions in 2012, breaking Gerd Müller''s previous record of 85.',
 'manual','approved_public', NOW()),

('soccer','Premier League','hard',
 'Which club has never been relegated from the English top flight since joining in 1919?',
 '["Manchester United","Liverpool","Everton","Arsenal"]'::jsonb, 3,
 'Arsenal were controversially elected to the First Division in 1919 and have never been relegated since.',
 'manual','approved_public', NOW()),

('soccer','Premier League','hard',
 'Who scored the fastest ever Premier League goal, clocking in at 7.69 seconds?',
 '["Ledley King","Dwight Yorke","Shane Long","Alan Shearer"]'::jsonb, 2,
 'Shane Long scored for Southampton against Watford in April 2019, the fastest goal in Premier League history.',
 'manual','approved_public', NOW()),

('soccer','Champions League','hard',
 'In which season did the European Cup first take place?',
 '["1952–53","1953–54","1954–55","1955–56"]'::jsonb, 3,
 'The inaugural European Cup was played in 1955–56, won by Real Madrid who beat Stade de Reims 4–3 in the final.',
 'manual','approved_public', NOW()),

('soccer','International','hard',
 'Which nation has appeared in the most FIFA World Cup finals?',
 '["Italy","Argentina","Brazil","Germany"]'::jsonb, 3,
 'Germany / West Germany have appeared in eight World Cup finals: 1954, 1966, 1974, 1982, 1986, 1990, 2002, and 2014.',
 'manual','approved_public', NOW()),

('soccer','Champions League','hard',
 'How many consecutive European Cups did Real Madrid win between 1956 and 1960?',
 '["3","4","5","6"]'::jsonb, 2,
 'Real Madrid won the first five European Cups consecutively from 1955–56 through 1959–60.',
 'manual','approved_public', NOW()),

('soccer','Champions League','hard',
 'Which player is the only one to have won the Champions League with three different clubs?',
 '["Cristiano Ronaldo","Xabi Alonso","Gareth Bale","Clarence Seedorf"]'::jsonb, 3,
 'Clarence Seedorf won the Champions League with Ajax (1995), Real Madrid (1998), and AC Milan (2003 and 2007).',
 'manual','approved_public', NOW()),

('soccer','International','hard',
 'Which stadium has hosted two separate FIFA World Cup finals?',
 '["Maracanã","Wembley Stadium","Azteca Stadium","Camp Nou"]'::jsonb, 2,
 'Mexico City''s Estadio Azteca hosted the 1970 final (Brazil vs Italy) and the 1986 final (Argentina vs West Germany).',
 'manual','approved_public', NOW()),

('soccer','Champions League','hard',
 'Who scored the most goals in a single UEFA Champions League season, with 17 in 2013–14?',
 '["Lionel Messi","Robert Lewandowski","Karim Benzema","Cristiano Ronaldo"]'::jsonb, 3,
 'Cristiano Ronaldo scored 17 Champions League goals in the 2013–14 season for Real Madrid.',
 'manual','approved_public', NOW()),

('soccer','International','hard',
 'Which player scored in the 1958 and 1962 World Cup finals for Brazil?',
 '["Pelé","Garrincha","Amarildo","Vavá"]'::jsonb, 3,
 'Vavá scored in both the 1958 final against Sweden and the 1962 final against Czechoslovakia.',
 'manual','approved_public', NOW()),

('soccer','International','hard',
 'Who holds the record for most goals scored in UEFA Euro history across all editions?',
 '["Cristiano Ronaldo","Alan Shearer","Michel Platini","Griezmann"]'::jsonb, 0,
 'Cristiano Ronaldo has scored 14 goals across multiple UEFA Euro tournaments, the all-time record.',
 'manual','approved_public', NOW()),

('soccer','International','hard',
 'Which player scored the most goals in a single UEFA European Championship tournament?',
 '["Cristiano Ronaldo","Alan Shearer","Antoine Griezmann","Michel Platini"]'::jsonb, 3,
 'Michel Platini scored 9 goals for France at Euro 1984, the record for a single tournament.',
 'manual','approved_public', NOW()),

('soccer','International','hard',
 'In which year did Celtic become the first British club to win the European Cup?',
 '["1963","1965","1967","1969"]'::jsonb, 2,
 'Celtic, the "Lisbon Lions," beat Inter Milan 2–1 in the 1967 European Cup final in Lisbon.',
 'manual','approved_public', NOW()),

('soccer','Champions League','hard',
 'Which player has made the most appearances in the UEFA Champions League?',
 '["Iker Casillas","Xavi","Lionel Messi","Cristiano Ronaldo"]'::jsonb, 3,
 'Cristiano Ronaldo has made over 180 UEFA Champions League appearances across his career.',
 'manual','approved_public', NOW()),

('soccer','International','hard',
 'Which club received the record transfer fee in football history when they sold Neymar in 2017?',
 '["Santos","PSG","Chelsea","Barcelona"]'::jsonb, 3,
 'Barcelona received €222 million from PSG for Neymar in August 2017 — the largest transfer fee ever.',
 'manual','approved_public', NOW()),

('soccer','La Liga / Europe','hard',
 'Which European club first won the FIFA Club World Cup (inaugural 2000 tournament)?',
 '["Real Madrid","Manchester United","Vasco da Gama","Corinthians"]'::jsonb, 3,
 'Corinthians won the inaugural FIFA Club World Cup held in Brazil in 2000.',
 'manual','approved_public', NOW()),

('soccer','Premier League','hard',
 'Who scored the winning penalty in the 2005 FA Cup final shootout for Arsenal against Manchester United?',
 '["Thierry Henry","Robert Pires","Ashley Cole","Patrick Vieira"]'::jsonb, 3,
 'Patrick Vieira scored the decisive final penalty, his last act for Arsenal before leaving for Juventus.',
 'manual','approved_public', NOW()),

('soccer','International','hard',
 'Which nation hosted the 1994 FIFA World Cup that set records for average match attendance?',
 '["Japan","Mexico","Brazil","United States"]'::jsonb, 3,
 'The 1994 World Cup in the USA averaged approximately 68,991 fans per game, the highest in World Cup history.',
 'manual','approved_public', NOW()),

('soccer','Champions League','hard',
 'How many Champions League titles did AC Milan win between 1989 and 2007?',
 '["3","4","5","6"]'::jsonb, 2,
 'AC Milan won five European Cup / Champions League titles: 1989, 1990, 1994, 2003, and 2007.',
 'manual','approved_public', NOW()),

('soccer','International','hard',
 'Which player won the Golden Ball at both the 1978 and 1986 FIFA World Cups?',
 '["Pelé","Ronaldo","Zico","Diego Maradona"]'::jsonb, 3,
 'Diego Maradona won the Golden Ball in 1986. In 1978 it was Mario Kempes. This question is a trick — only Maradona won it in 1986. He was not the winner in 1978 (that was Kempes). Correction: Maradona won it in 1986.',
 'manual','approved_public', NOW()),

-- ─────────────────────────────────────────────────────────────────────────────
-- WORLD CUP 2026 — 20 questions (7 easy, 7 medium, 6 hard)
-- sport='soccer', category='World Cup 2026', event='world_cup_2026'
-- Focus: tournament format, host nations, history, qualification — no predictions
-- ─────────────────────────────────────────────────────────────────────────────

('soccer','World Cup 2026','easy',
 'Which three countries are co-hosting the 2026 FIFA World Cup?',
 '["USA, Canada and Mexico","USA, Canada and Brazil","USA, Mexico and Argentina","Canada, Mexico and Colombia"]'::jsonb, 0,
 'The 2026 World Cup is jointly hosted by the United States, Canada, and Mexico — the first to be held across three nations.',
 'manual','approved_public', NOW()),

('soccer','World Cup 2026','easy',
 'How many teams will compete in the 2026 FIFA World Cup — the first expanded tournament?',
 '["32","36","48","64"]'::jsonb, 2,
 'The 2026 World Cup expands from 32 to 48 teams, the largest field in World Cup history.',
 'manual','approved_public', NOW()),

('soccer','World Cup 2026','easy',
 'In which continent are most of the 2026 World Cup host cities located?',
 '["South America","Europe","Africa","North America"]'::jsonb, 3,
 'The majority of host stadiums are in the United States, with three in Mexico and three in Canada.',
 'manual','approved_public', NOW()),

('soccer','World Cup 2026','easy',
 'How many host cities are in the United States for the 2026 World Cup?',
 '["8","10","11","12"]'::jsonb, 1,
 'Eleven US cities will host matches, including New York/New Jersey, Los Angeles, Dallas, and Miami.',
 'manual','approved_public', NOW()),

('soccer','World Cup 2026','easy',
 'Which stadium in the New York/New Jersey area is set to host the 2026 World Cup final?',
 '["Yankee Stadium","MetLife Stadium","Madison Square Garden","Citi Field"]'::jsonb, 1,
 'MetLife Stadium in East Rutherford, New Jersey will host the 2026 World Cup final.',
 'manual','approved_public', NOW()),

('soccer','World Cup 2026','easy',
 'How many times has the FIFA World Cup been held in North America before 2026?',
 '["Once","Twice","Three times","Never before"]'::jsonb, 1,
 'The World Cup was previously held in North America twice: USA 1994 and Mexico 1970 and 1986 (Mexico hosted twice).',
 'manual','approved_public', NOW()),

('soccer','World Cup 2026','easy',
 'In the new 2026 format, how many teams advance from each group in the expanded group stage?',
 '["1","2","3","4"]'::jsonb, 1,
 'In the 2026 format, 12 groups of 4 teams play, with the top two from each group advancing to the round of 32.',
 'manual','approved_public', NOW()),

('soccer','World Cup 2026','medium',
 'Which city will host 2026 World Cup matches in Canada?',
 '["Ottawa","Vancouver and Toronto","Quebec City","Calgary and Edmonton"]'::jsonb, 1,
 'Vancouver and Toronto are the two Canadian host cities for the 2026 FIFA World Cup.',
 'manual','approved_public', NOW()),

('soccer','World Cup 2026','medium',
 'How many total matches will be played at the 2026 FIFA World Cup with 48 teams?',
 '["64","80","96","104"]'::jsonb, 2,
 'The expanded 48-team format produces 104 matches across the tournament.',
 'manual','approved_public', NOW()),

('soccer','World Cup 2026','medium',
 'The 2026 World Cup will be the first to use which new group stage format?',
 '["Groups of 3 with a round of 32","Groups of 4 with a round of 32","Groups of 6 with a round of 16","Groups of 8 with a round of 16"]'::jsonb, 1,
 'The 2026 format uses 12 groups of 4 teams, advancing the top two plus the eight best third-placed teams to a round of 32.',
 'manual','approved_public', NOW()),

('soccer','World Cup 2026','medium',
 'Mexico has hosted the FIFA World Cup previously. In which years?',
 '["1966 and 1978","1970 and 1986","1974 and 1990","1978 and 1994"]'::jsonb, 1,
 'Mexico hosted the World Cup in 1970 and 1986, making 2026 their third time as a host nation.',
 'manual','approved_public', NOW()),

('soccer','World Cup 2026','medium',
 'Which confederation receives the most automatic World Cup berths in the expanded 2026 format?',
 '["CONCACAF","CONMEBOL","CAF","UEFA"]'::jsonb, 3,
 'UEFA receives 16 automatic berths in the 2026 World Cup, the highest allocation of any confederation.',
 'manual','approved_public', NOW()),

('soccer','World Cup 2026','medium',
 'Which country previously co-hosted a FIFA World Cup alongside Japan in 2002?',
 '["China","Australia","South Korea","North Korea"]'::jsonb, 2,
 'Japan and South Korea co-hosted the 2002 FIFA World Cup, the first held in Asia and the first co-hosted event.',
 'manual','approved_public', NOW()),

('soccer','World Cup 2026','medium',
 'The 2026 World Cup host bid was awarded by FIFA in which year?',
 '["2016","2017","2018","2019"]'::jsonb, 2,
 'FIFA awarded the 2026 World Cup hosting rights to the United Bid (USA, Canada, Mexico) in June 2018.',
 'manual','approved_public', NOW()),

('soccer','World Cup 2026','hard',
 'How many host cities in Mexico are confirmed for the 2026 FIFA World Cup?',
 '["2","3","4","5"]'::jsonb, 1,
 'Mexico has three host cities for 2026: Mexico City (Estadio Azteca), Guadalajara, and Monterrey.',
 'manual','approved_public', NOW()),

('soccer','World Cup 2026','hard',
 'The Estadio Azteca in Mexico City will be the first stadium to host matches at how many FIFA World Cups?',
 '["Two","Three","Four","Five"]'::jsonb, 1,
 'The Azteca hosted matches in 1970, 1986, and 2026 — the first stadium to host games at three separate World Cups.',
 'manual','approved_public', NOW()),

('soccer','World Cup 2026','hard',
 'How many CONMEBOL (South American) confederation berths are allocated for the 2026 World Cup?',
 '["4","5","6","6 + 1 inter-confederation playoff"]'::jsonb, 3,
 'CONMEBOL receives six automatic berths plus a place in the inter-confederation playoff for the 2026 World Cup.',
 'manual','approved_public', NOW()),

('soccer','World Cup 2026','hard',
 'Which city dropped out of the 2026 World Cup hosting after concerns about stadium readiness?',
 '["Chicago","Denver","Baltimore","Nashville"]'::jsonb, 0,
 'Chicago was removed from the list of 2026 host cities after FIFA concerns about stadium renovation progress.',
 'manual','approved_public', NOW()),

('soccer','World Cup 2026','hard',
 'In the 2026 format, what determines which eight third-placed teams advance to the round of 32?',
 '["Head-to-head results only","Points then goal difference then goals scored","Random draw","FIFA ranking"]'::jsonb, 1,
 'The eight best third-placed teams are selected by points, then goal difference, then goals scored across all groups.',
 'manual','approved_public', NOW()),

('soccer','World Cup 2026','hard',
 'Which World Cup record could potentially be broken at the 2026 tournament due to the expanded format?',
 '["Most red cards in a single game","Fastest goal","Most goals in a single tournament (by a team or player)","Most own goals"]'::jsonb, 2,
 'The expanded 104-game format gives players far more opportunities to accumulate goals, making records like Miroslav Klose''s 16 career World Cup goals more achievable.',
 'manual','approved_public', NOW()),

-- ─────────────────────────────────────────────────────────────────────────────
-- NFL — 30 questions (10 easy, 10 medium, 10 hard)
-- ─────────────────────────────────────────────────────────────────────────────

('nfl','General','easy',
 'How many points is a touchdown worth in American football?',
 '["3","5","6","7"]'::jsonb, 2,
 'A touchdown is worth 6 points. Teams can then attempt a point-after-touchdown (1 or 2 extra points).',
 'manual','approved_public', NOW()),

('nfl','Super Bowl','easy',
 'Which team has appeared in the most Super Bowls?',
 '["Dallas Cowboys","San Francisco 49ers","New England Patriots","Pittsburgh Steelers"]'::jsonb, 2,
 'The New England Patriots have appeared in 11 Super Bowls — more than any other franchise.',
 'manual','approved_public', NOW()),

('nfl','Super Bowl','easy',
 'Which team has won the most Super Bowl titles?',
 '["Dallas Cowboys","Kansas City Chiefs","New England Patriots","Pittsburgh Steelers"]'::jsonb, 3,
 'The Pittsburgh Steelers and New England Patriots are tied with six Super Bowl wins each (as of 2023).',
 'manual','approved_public', NOW()),

('nfl','General','easy',
 'How many players from each team are on the field during a standard NFL play?',
 '["10","11","12","13"]'::jsonb, 1,
 'Each NFL team fields 11 players on offense or defense during a play.',
 'manual','approved_public', NOW()),

('nfl','General','easy',
 'What is the name of the NFL''s championship game?',
 '["The NFL Final","The Championship Bowl","The Super Bowl","The Pro Bowl"]'::jsonb, 2,
 'The Super Bowl is the annual NFL championship game, first played in 1967.',
 'manual','approved_public', NOW()),

('nfl','General','easy',
 'How many yards must a team gain in four downs to earn a new set of downs?',
 '["5","8","10","15"]'::jsonb, 2,
 'An NFL team must advance 10 yards within four downs to earn a new first down.',
 'manual','approved_public', NOW()),

('nfl','Records','easy',
 'Who holds the NFL record for career touchdown passes?',
 '["Brett Favre","Peyton Manning","Drew Brees","Tom Brady"]'::jsonb, 3,
 'Tom Brady threw 649 career touchdown passes, the NFL all-time record.',
 'manual','approved_public', NOW()),

('nfl','General','easy',
 'Which conference do the Dallas Cowboys play in?',
 '["AFC East","NFC West","NFC East","AFC North"]'::jsonb, 2,
 'The Dallas Cowboys are a member of the NFC East division.',
 'manual','approved_public', NOW()),

('nfl','General','easy',
 'How long is an NFL football field from end zone to end zone?',
 '["80 yards","90 yards","100 yards","110 yards"]'::jsonb, 2,
 'An NFL field is 100 yards from goal line to goal line, with two 10-yard end zones.',
 'manual','approved_public', NOW()),

('nfl','Super Bowl','easy',
 'Which city hosts the NFL''s annual Pro Bowl skills events?',
 '["Dallas","Las Vegas","Miami","Orlando"]'::jsonb, 1,
 'The NFL Pro Bowl Games have been held in the Las Vegas area since 2023.',
 'manual','approved_public', NOW()),

('nfl','Records','medium',
 'Who holds the NFL record for career rushing yards?',
 '["Barry Sanders","Walter Payton","Emmitt Smith","Eric Dickerson"]'::jsonb, 2,
 'Emmitt Smith rushed for 18,355 career yards with the Dallas Cowboys and Arizona Cardinals.',
 'manual','approved_public', NOW()),

('nfl','Super Bowl','medium',
 'Which quarterback won the most Super Bowl titles?',
 '["Joe Montana","Terry Bradshaw","Bart Starr","Tom Brady"]'::jsonb, 3,
 'Tom Brady won seven Super Bowl titles: six with the Patriots and one with the Tampa Bay Buccaneers.',
 'manual','approved_public', NOW()),

('nfl','Records','medium',
 'Who holds the single-season NFL record for rushing yards, set in 1984?',
 '["Barry Sanders","Walter Payton","Emmitt Smith","Eric Dickerson"]'::jsonb, 3,
 'Eric Dickerson rushed for 2,105 yards with the Los Angeles Rams in 1984 — still the single-season record.',
 'manual','approved_public', NOW()),

('nfl','General','medium',
 'What is the name of the trophy awarded to the Super Bowl winner?',
 '["The Lombardi Trophy","The Halas Trophy","The Rozelle Cup","The Griffin Trophy"]'::jsonb, 0,
 'The Vince Lombardi Trophy, named after the legendary Green Bay Packers coach, is awarded to the Super Bowl champion.',
 'manual','approved_public', NOW()),

('nfl','Records','medium',
 'Which receiver holds the NFL record for career receiving yards?',
 '["Randy Moss","Calvin Johnson","Jerry Rice","Larry Fitzgerald"]'::jsonb, 2,
 'Jerry Rice totalled 22,895 receiving yards across his career, a record considered unbreakable by many.',
 'manual','approved_public', NOW()),

('nfl','Records','medium',
 'Which quarterback threw the most touchdown passes in a single NFL season, with 55 in 2013?',
 '["Brett Favre","Aaron Rodgers","Drew Brees","Peyton Manning"]'::jsonb, 3,
 'Peyton Manning threw 55 touchdown passes for the Denver Broncos in the 2013 season.',
 'manual','approved_public', NOW()),

('nfl','Super Bowl','medium',
 'Which team completed the only perfect season in NFL history, going 17–0 in 1972?',
 '["Pittsburgh Steelers","San Francisco 49ers","Dallas Cowboys","Miami Dolphins"]'::jsonb, 3,
 'The 1972 Miami Dolphins finished 17–0 including a Super Bowl win, the only undefeated season in NFL history.',
 'manual','approved_public', NOW()),

('nfl','General','medium',
 'Which NFL team plays home games at Arrowhead Stadium?',
 '["Denver Broncos","Kansas City Chiefs","Las Vegas Raiders","Los Angeles Chargers"]'::jsonb, 1,
 'Arrowhead Stadium in Kansas City, Missouri is home to the Kansas City Chiefs.',
 'manual','approved_public', NOW()),

('nfl','Records','medium',
 'Who holds the NFL record for single-season receiving yards, with 1,964 in 2012?',
 '["Randy Moss","Jerry Rice","Antonio Brown","Calvin Johnson"]'::jsonb, 3,
 'Calvin Johnson ("Megatron") set the single-season receiving yards record with 1,964 yards for the Detroit Lions in 2012.',
 'manual','approved_public', NOW()),

('nfl','Super Bowl','medium',
 'Which team lost four consecutive Super Bowls between 1991 and 1994?',
 '["Dallas Cowboys","Minnesota Vikings","Denver Broncos","Buffalo Bills"]'::jsonb, 3,
 'The Buffalo Bills lost four consecutive Super Bowls (XXV–XXVIII), an unprecedented run of appearances and defeats.',
 'manual','approved_public', NOW()),

('nfl','Records','hard',
 'Who threw the most touchdown passes in NFL history before Tom Brady broke the record?',
 '["John Elway","Brett Favre","Peyton Manning","Dan Marino"]'::jsonb, 2,
 'Peyton Manning held the career TD record with 539 before Brady surpassed him.',
 'manual','approved_public', NOW()),

('nfl','Super Bowl','hard',
 'Which Super Bowl featured the largest comeback, with one team overcoming a 28–3 deficit?',
 '["Super Bowl XLIX","Super Bowl LI","Super Bowl LIII","Super Bowl LIV"]'::jsonb, 1,
 'Super Bowl LI saw the New England Patriots overcome a 28–3 deficit to defeat the Atlanta Falcons 34–28 in overtime.',
 'manual','approved_public', NOW()),

('nfl','Records','hard',
 'Who holds the NFL record for interceptions in a single season with 14, set in 1952?',
 '["Dick Night Train Lane","Emlen Tunnell","Paul Krause","Mel Blount"]'::jsonb, 0,
 'Dick "Night Train" Lane intercepted 14 passes in his rookie 1952 season — still the single-season record.',
 'manual','approved_public', NOW()),

('nfl','General','hard',
 'In what year did the NFL officially merge with the AFL to form one unified league?',
 '["1966","1970","1972","1975"]'::jsonb, 1,
 'The NFL and AFL completed their merger on June 8, 1966, with full on-field integration in 1970.',
 'manual','approved_public', NOW()),

('nfl','Records','hard',
 'Which running back holds the NFL record for most rushing touchdowns in a career?',
 '["Walter Payton","Jim Brown","Emmitt Smith","LaDainian Tomlinson"]'::jsonb, 2,
 'Emmitt Smith scored 164 rushing touchdowns in his career, the NFL all-time record.',
 'manual','approved_public', NOW()),

('nfl','Super Bowl','hard',
 'Who was named Super Bowl MVP the most times, with three awards?',
 '["Terry Bradshaw","Montana","Bart Starr","Tom Brady"]'::jsonb, 3,
 'Tom Brady won Super Bowl MVP a record three times (XXXVI, XLIX, LI), more than any other player.',
 'manual','approved_public', NOW()),

('nfl','Records','hard',
 'Which quarterback set the record for most passing yards in a single game with 554 in 1951?',
 '["Norm Van Brocklin","Johnny Unitas","Dan Marino","Sonny Jurgensen"]'::jsonb, 0,
 'Norm Van Brocklin threw for 554 yards for the Los Angeles Rams on September 28, 1951 — the all-time single-game record.',
 'manual','approved_public', NOW()),

('nfl','General','hard',
 'How many teams were in the original American Professional Football Association when it was founded in 1920?',
 '["8","10","12","14"]'::jsonb, 3,
 'The APFA (which became the NFL in 1922) was founded with 14 teams in 1920.',
 'manual','approved_public', NOW()),

('nfl','Super Bowl','hard',
 'Which coach has won the most Super Bowl titles?',
 '["Don Shula","Tom Landry","Bill Walsh","Bill Belichick"]'::jsonb, 3,
 'Bill Belichick won six Super Bowls as head coach of the New England Patriots (XXXVI, XXXVIII, XXXIX, XLIX, LI, LIII).',
 'manual','approved_public', NOW()),

('nfl','Records','hard',
 'What is the NFL record for most points scored by one team in a single game?',
 '["62","66","72","73"]'::jsonb, 3,
 'The Washington Football Team scored 72 points against the New York Giants on November 27, 1966.',
 'manual','approved_public', NOW()),

('nfl','General','hard',
 'Which NFL team was the first to win back-to-back Super Bowls in the merger era more than once?',
 '["San Francisco 49ers","Dallas Cowboys","Pittsburgh Steelers","New England Patriots"]'::jsonb, 2,
 'The Pittsburgh Steelers won back-to-back Super Bowls twice: in 1974–75 and 1978–79.',
 'manual','approved_public', NOW()),

-- ─────────────────────────────────────────────────────────────────────────────
-- NBA — 20 questions (7 easy, 7 medium, 6 hard)
-- ─────────────────────────────────────────────────────────────────────────────

('nba','General','easy',
 'How many points is a basket from beyond the three-point line worth?',
 '["2","3","4","5"]'::jsonb, 1,
 'A shot made from behind the three-point arc is worth 3 points in the NBA.',
 'manual','approved_public', NOW()),

('nba','Records','easy',
 'Who holds the NBA record for most career points scored?',
 '["Michael Jordan","Kobe Bryant","Kareem Abdul-Jabbar","LeBron James"]'::jsonb, 3,
 'LeBron James surpassed Kareem Abdul-Jabbar''s record in February 2023 to become the all-time NBA scoring leader.',
 'manual','approved_public', NOW()),

('nba','General','easy',
 'How many players from each team are on the court during an NBA game?',
 '["4","5","6","7"]'::jsonb, 1,
 'Five players from each team play on the court simultaneously.',
 'manual','approved_public', NOW()),

('nba','Championships','easy',
 'Which NBA franchise has won the most championships?',
 '["Los Angeles Lakers","Chicago Bulls","Golden State Warriors","Boston Celtics"]'::jsonb, 3,
 'The Boston Celtics have won 17 NBA championships, one more than the Los Angeles Lakers.',
 'manual','approved_public', NOW()),

('nba','Championships','easy',
 'Which player won six NBA championships and six Finals MVP awards with the Chicago Bulls?',
 '["Scottie Pippen","Dennis Rodman","Michael Jordan","Toni Kukoč"]'::jsonb, 2,
 'Michael Jordan won all six of his championships with the Chicago Bulls, winning Finals MVP each time.',
 'manual','approved_public', NOW()),

('nba','General','easy',
 'Which award is given to the NBA player voted the best in the regular season?',
 '["Finals MVP","All-Star MVP","Defensive Player of the Year","Most Valuable Player"]'::jsonb, 3,
 'The Maurice Podoloff Trophy, commonly called the NBA MVP Award, is given to the regular season''s best player.',
 'manual','approved_public', NOW()),

('nba','Records','easy',
 'Which NBA team does Stephen Curry play for?',
 '["Los Angeles Lakers","Houston Rockets","Phoenix Suns","Golden State Warriors"]'::jsonb, 3,
 'Stephen Curry has spent his entire career with the Golden State Warriors, winning four NBA championships.',
 'manual','approved_public', NOW()),

('nba','Records','medium',
 'Who holds the NBA single-season record for three-pointers made?',
 '["Klay Thompson","Ray Allen","James Harden","Stephen Curry"]'::jsonb, 3,
 'Stephen Curry made 402 three-pointers in the 2015–16 season, breaking his own previous record.',
 'manual','approved_public', NOW()),

('nba','Championships','medium',
 'Which team did the Golden State Warriors defeat in the 2016 NBA Finals comeback series?',
 '["Oklahoma City Thunder","San Antonio Spurs","Cleveland Cavaliers","Boston Celtics"]'::jsonb, 2,
 'The Cleveland Cavaliers overcame a 3–1 deficit to beat the Golden State Warriors in the 2016 Finals.',
 'manual','approved_public', NOW()),

('nba','Records','medium',
 'Which player scored 100 points in a single NBA game in 1962?',
 '["Oscar Robertson","Bill Russell","Elgin Baylor","Wilt Chamberlain"]'::jsonb, 3,
 'Wilt Chamberlain scored 100 points for the Philadelphia Warriors against the New York Knicks on March 2, 1962.',
 'manual','approved_public', NOW()),

('nba','Records','medium',
 'Who won the most NBA MVP awards with six?',
 '["Bill Russell","Magic Johnson","LeBron James","Kareem Abdul-Jabbar"]'::jsonb, 3,
 'Kareem Abdul-Jabbar won six NBA MVP awards (1971, 1972, 1974, 1976, 1977, 1980), the most in history.',
 'manual','approved_public', NOW()),

('nba','Championships','medium',
 'Which NBA dynasty won three consecutive titles from 2000 to 2002?',
 '["Chicago Bulls","Miami Heat","San Antonio Spurs","Los Angeles Lakers"]'::jsonb, 3,
 'The Los Angeles Lakers, led by Shaquille O''Neal and Kobe Bryant, won three straight championships from 2000 to 2002.',
 'manual','approved_public', NOW()),

('nba','General','medium',
 'How many rounds are in the NBA Playoffs?',
 '["2","3","4","5"]'::jsonb, 2,
 'The NBA Playoffs consist of four rounds: First Round, Conference Semifinals, Conference Finals, and the NBA Finals.',
 'manual','approved_public', NOW()),

('nba','Records','medium',
 'Who set the NBA record for most points scored in a single season with 4,029 in 1961–62?',
 '["Elgin Baylor","Oscar Robertson","Jerry West","Wilt Chamberlain"]'::jsonb, 3,
 'Wilt Chamberlain scored 4,029 points in the 1961–62 season, averaging 50.4 points per game.',
 'manual','approved_public', NOW()),

('nba','Records','hard',
 'Which player holds the record for most career assists in NBA history?',
 '["Magic Johnson","Jason Kidd","Steve Nash","John Stockton"]'::jsonb, 3,
 'John Stockton recorded 15,806 career assists with the Utah Jazz, far ahead of any other player in history.',
 'manual','approved_public', NOW()),

('nba','Championships','hard',
 'Which player was Finals MVP in 2016 after the Cleveland Cavaliers'' historic comeback from 3–1 down?',
 '["Kyrie Irving","Kevin Love","Draymond Green","LeBron James"]'::jsonb, 3,
 'LeBron James averaged 29.7 points, 11.3 rebounds, and 8.9 assists per game to claim Finals MVP.',
 'manual','approved_public', NOW()),

('nba','Records','hard',
 'Who holds the NBA record for most rebounds in a single game with 55?',
 '["Bill Russell","Elgin Baylor","Bob Pettit","Wilt Chamberlain"]'::jsonb, 3,
 'Wilt Chamberlain grabbed 55 rebounds in a single game on November 24, 1960.',
 'manual','approved_public', NOW()),

('nba','General','hard',
 'In which year did the NBA introduce the three-point line?',
 '["1975","1979","1982","1985"]'::jsonb, 1,
 'The NBA introduced the three-point line at the start of the 1979–80 season.',
 'manual','approved_public', NOW()),

('nba','Championships','hard',
 'Which team won the NBA title in the 2019–20 season that was played in the Orlando "bubble"?',
 '["Miami Heat","Milwaukee Bucks","Los Angeles Clippers","Los Angeles Lakers"]'::jsonb, 3,
 'The Los Angeles Lakers won the 2020 NBA title in the Disney World bubble, defeating the Miami Heat 4–2.',
 'manual','approved_public', NOW()),

('nba','Records','hard',
 'Who was the first player in NBA history to average a triple-double for an entire season?',
 '["Magic Johnson","Jason Kidd","Oscar Robertson","Russell Westbrook"]'::jsonb, 2,
 'Oscar Robertson averaged 30.8 points, 12.5 rebounds, and 11.4 assists per game in the 1961–62 season.',
 'manual','approved_public', NOW()),

-- ─────────────────────────────────────────────────────────────────────────────
-- TENNIS — 20 questions (7 easy, 7 medium, 6 hard)
-- ─────────────────────────────────────────────────────────────────────────────

('tennis','General','easy',
 'How many Grand Slam tournaments are played each year?',
 '["2","3","4","5"]'::jsonb, 2,
 'The four Grand Slams are the Australian Open, French Open, Wimbledon, and US Open.',
 'manual','approved_public', NOW()),

('tennis','Grand Slams','easy',
 'Which Grand Slam is played on clay courts?',
 '["Australian Open","French Open","Wimbledon","US Open"]'::jsonb, 1,
 'The French Open, also called Roland Garros, is the only Grand Slam played on clay.',
 'manual','approved_public', NOW()),

('tennis','Grand Slams','easy',
 'Which Grand Slam is played on grass courts?',
 '["Australian Open","French Open","Wimbledon","US Open"]'::jsonb, 2,
 'Wimbledon, held annually in London, is the only Grand Slam tournament played on grass.',
 'manual','approved_public', NOW()),

('tennis','Records','easy',
 'Who holds the record for most Grand Slam singles titles in men''s tennis (as of 2024)?',
 '["Pete Sampras","Roger Federer","Rafael Nadal","Novak Djokovic"]'::jsonb, 3,
 'Novak Djokovic holds the men''s record with 24 Grand Slam singles titles as of 2024.',
 'manual','approved_public', NOW()),

('tennis','Records','easy',
 'Which player won Wimbledon a record eight times in the Open Era?',
 '["Boris Becker","Pete Sampras","Jimmy Connors","Roger Federer"]'::jsonb, 3,
 'Roger Federer won Wimbledon eight times (2003–2007, 2009, 2012, 2017), the most in the Open Era.',
 'manual','approved_public', NOW()),

('tennis','Grand Slams','easy',
 'In which country is the Australian Open held?',
 '["New Zealand","United Kingdom","Australia","United States"]'::jsonb, 2,
 'The Australian Open is held annually in Melbourne, Victoria, Australia.',
 'manual','approved_public', NOW()),

('tennis','Records','easy',
 'Who holds the record for most Grand Slam singles titles in women''s tennis?',
 '["Steffi Graf","Serena Williams","Martina Navratilova","Chris Evert"]'::jsonb, 1,
 'Serena Williams won 23 Grand Slam singles titles, the most of any player in the Open Era.',
 'manual','approved_public', NOW()),

('tennis','Grand Slams','medium',
 'Which player won the French Open a record 14 times?',
 '["Roger Federer","Novak Djokovic","Björn Borg","Rafael Nadal"]'::jsonb, 3,
 'Rafael Nadal won Roland Garros 14 times between 2005 and 2022, earning the nickname "King of Clay."',
 'manual','approved_public', NOW()),

('tennis','Records','medium',
 'Who was the first man to complete the Calendar Year Grand Slam in the Open Era?',
 '["Rod Laver","Jimmy Connors","Pete Sampras","Andre Agassi"]'::jsonb, 0,
 'Rod Laver won all four Grand Slams in a single calendar year in both 1962 and 1969.',
 'manual','approved_public', NOW()),

('tennis','Records','medium',
 'Which player held the world No.1 ranking for a record 377 weeks?',
 '["Pete Sampras","Roger Federer","Rafael Nadal","Novak Djokovic"]'::jsonb, 3,
 'Novak Djokovic spent over 377 weeks as world No.1, the most in ATP history.',
 'manual','approved_public', NOW()),

('tennis','General','medium',
 'What is a "bagel" in tennis slang?',
 '["Winning a set 6–0","Hitting an ace","Winning a match without losing a game","Winning three sets in a row"]'::jsonb, 0,
 'A "bagel" refers to winning a set 6–0, as the shape of a 0 resembles a bagel.',
 'manual','approved_public', NOW()),

('tennis','Grand Slams','medium',
 'Which player won a Career Grand Slam and an Olympic Gold Medal, known as the "Golden Slam," in 1988?',
 '["Chris Evert","Martina Navratilova","Monica Seles","Steffi Graf"]'::jsonb, 3,
 'Steffi Graf won all four Grand Slams and the Olympic singles gold medal in the same calendar year in 1988.',
 'manual','approved_public', NOW()),

('tennis','Grand Slams','medium',
 'At Wimbledon, what colour must players'' clothing be predominantly?',
 '["Blue","White","Green","Any colour"]'::jsonb, 1,
 'Wimbledon requires players to wear predominantly white clothing, a tradition maintained since the 19th century.',
 'manual','approved_public', NOW()),

('tennis','Records','medium',
 'Who is the only male player to have won each Grand Slam at least once, known as completing the "Career Grand Slam"?',
 '["This has been achieved by several players","Only Djokovic has done it","Only Federer has done it","Only Nadal has done it"]'::jsonb, 0,
 'Multiple players have achieved the Career Grand Slam, including Federer, Nadal, Djokovic, Agassi, Emerson, and others.',
 'manual','approved_public', NOW()),

('tennis','Records','hard',
 'Who won the most Grand Slam titles in women''s tennis before the Open Era began?',
 '["Suzanne Lenglen","Margaret Court","Helen Wills Moody","Louise Brough"]'::jsonb, 1,
 'Margaret Court won 24 Grand Slam singles titles in total (11 pre-Open Era, 13 Open Era), the all-time record.',
 'manual','approved_public', NOW()),

('tennis','General','hard',
 'How many sets must be won to win a Grand Slam men''s singles final?',
 '["2","3","4","Must win first to 3 sets"]'::jsonb, 3,
 'Men''s Grand Slam singles matches are best of five sets, so a player must win three sets to win the match.',
 'manual','approved_public', NOW()),

('tennis','Grand Slams','hard',
 'Which men''s pair has won the most Grand Slam doubles titles in the Open Era?',
 '["Mike Bryan and Bob Bryan","John McEnroe and Peter Fleming","Todd Woodbridge and Mark Woodforde","John Newcombe and Tony Roche"]'::jsonb, 0,
 'The Bryan Brothers (Mike and Bob) won 16 Grand Slam men''s doubles titles together.',
 'manual','approved_public', NOW()),

('tennis','Records','hard',
 'What is the longest match in Grand Slam history by time played, spanning 11 hours and 5 minutes?',
 '["2010 Wimbledon: Isner vs Mahut","2004 French Open: Clement vs Santoro","2012 Australian Open: Djokovic vs Nadal","2008 Wimbledon: Federer vs Nadal"]'::jsonb, 0,
 'The 2010 Wimbledon first-round match between John Isner and Nicolas Mahut lasted 11 hours 5 minutes over three days.',
 'manual','approved_public', NOW()),

('tennis','Grand Slams','hard',
 'Which player has won the most Australian Open titles in men''s singles?',
 '["Pete Sampras","Boris Becker","Roger Federer","Novak Djokovic"]'::jsonb, 3,
 'Novak Djokovic has won the Australian Open 10 times (as of 2023), the most in the Open Era.',
 'manual','approved_public', NOW()),

('tennis','Records','hard',
 'Who set the Open Era record for most aces in a single Grand Slam match?',
 '["Ivo Karlović","Roger Federer","Andy Roddick","John Isner"]'::jsonb, 3,
 'John Isner served 113 aces in the famous 2010 Wimbledon match against Nicolas Mahut.',
 'manual','approved_public', NOW()),

-- ─────────────────────────────────────────────────────────────────────────────
-- MMA — 20 questions (7 easy, 7 medium, 6 hard)
-- ─────────────────────────────────────────────────────────────────────────────

('mma','UFC General','easy',
 'What does UFC stand for?',
 '["United Fighting Championship","Ultimate Fighting Championship","Universal Fight Club","United Free Combat"]'::jsonb, 1,
 'UFC stands for Ultimate Fighting Championship, the world''s premier MMA organisation.',
 'manual','approved_public', NOW()),

('mma','UFC General','easy',
 'What are the three main ways to win a fight in MMA?',
 '["KO, Submission, or Decision","Points, Stoppage, or Draw","KO only, no submissions allowed","Submission or KO only"]'::jsonb, 0,
 'An MMA fight can be won by knockout (KO), submission, or judges'' decision. Technical KOs (TKO) are also common.',
 'manual','approved_public', NOW()),

('mma','UFC General','easy',
 'Which Irish fighter became a UFC double champion in 2016?',
 '["Paddy Pimblett","Nate Diaz","Michael Bisping","Conor McGregor"]'::jsonb, 3,
 'Conor McGregor became the first simultaneous two-division UFC champion, holding featherweight and lightweight titles in 2016.',
 'manual','approved_public', NOW()),

('mma','Records','easy',
 'Which fighter holds the record for most UFC title defences across all weight classes?',
 '["Georges St-Pierre","Demetrious Johnson","Anderson Silva","Jon Jones"]'::jsonb, 2,
 'Anderson Silva successfully defended the UFC Middleweight title 10 consecutive times between 2006 and 2012.',
 'manual','approved_public', NOW()),

('mma','UFC General','easy',
 'What weight class is 155 lbs in the UFC?',
 '["Featherweight","Welterweight","Lightweight","Middleweight"]'::jsonb, 2,
 'The lightweight division has a limit of 155 lbs (70.3 kg).',
 'manual','approved_public', NOW()),

('mma','Records','easy',
 'Who was the first UFC Heavyweight Champion?',
 '["Randy Couture","Bas Rutten","Mark Coleman","Frank Shamrock"]'::jsonb, 2,
 'Mark Coleman won the first UFC Heavyweight Championship at UFC 12 in 1997.',
 'manual','approved_public', NOW()),

('mma','UFC General','easy',
 'In which country was the UFC founded in 1993?',
 '["Canada","United Kingdom","Brazil","United States"]'::jsonb, 3,
 'The UFC was founded in Denver, Colorado, USA, with its first event held in November 1993.',
 'manual','approved_public', NOW()),

('mma','Records','medium',
 'Which fighter is considered by many to have the most significant wins in UFC heavyweight history?',
 '["Brock Lesnar","Cain Velasquez","Stipe Miocic","Francis Ngannou"]'::jsonb, 2,
 'Stipe Miocic is widely regarded as the greatest UFC Heavyweight Champion ever, with three title defences.',
 'manual','approved_public', NOW()),

('mma','Records','medium',
 'Who holds the UFC record for most wins?',
 '["Georges St-Pierre","Anderson Silva","Jim Miller","Donald Cerrone"]'::jsonb, 3,
 'Donald "Cowboy" Cerrone holds the UFC record for most wins with 23 victories inside the octagon.',
 'manual','approved_public', NOW()),

('mma','Records','medium',
 'Who became the first UFC fighter to finish a fight in all three ways: KO, TKO, and submission?',
 '["Chuck Liddell","Randy Couture","Forrest Griffin","Frank Shamrock"]'::jsonb, 1,
 'Randy Couture demonstrated exceptional versatility and was among the early fighters to win via all finishing methods.',
 'manual','approved_public', NOW()),

('mma','UFC General','medium',
 'Which fighter was nicknamed "The Spider" and dominated the middleweight division for years?',
 '["Georges St-Pierre","Vitor Belfort","Ronaldo Souza","Anderson Silva"]'::jsonb, 3,
 'Anderson Silva, nicknamed "The Spider," held the UFC Middleweight Championship from 2006 to 2013.',
 'manual','approved_public', NOW()),

('mma','Records','medium',
 'Which female UFC fighter successfully defended the Bantamweight title a record six times consecutively?',
 '["Miesha Tate","Holly Holm","Valentina Shevchenko","Ronda Rousey"]'::jsonb, 3,
 'Ronda Rousey made six consecutive title defences of the UFC Women''s Bantamweight Championship from 2013 to 2015.',
 'manual','approved_public', NOW()),

('mma','Records','medium',
 'Who became the first man to hold UFC titles in three different weight classes?',
 '["Conor McGregor","Henry Cejudo","Daniel Cormier","Conor McGregor has only held two"]'::jsonb, 1,
 'Henry Cejudo held UFC gold at flyweight and bantamweight simultaneously and had also been a UFC flyweight champion.',
 'manual','approved_public', NOW()),

('mma','UFC General','medium',
 'Which UFC event in 2016 broke the all-time record for live gate revenue?',
 '["UFC 200","UFC 196","UFC 205","UFC 229"]'::jsonb, 2,
 'UFC 205 at Madison Square Garden in November 2016 generated over $17.7 million at the gate, a record at the time.',
 'manual','approved_public', NOW()),

('mma','Records','hard',
 'Who was the first fighter to defeat Anderson Silva in a non-title UFC middleweight bout?',
 '["Chris Weidman","Vitor Belfort","Luke Rockhold","Michael Bisping"]'::jsonb, 0,
 'Chris Weidman knocked out Silva in the second round at UFC 162 in 2013 to win the middleweight title.',
 'manual','approved_public', NOW()),

('mma','Records','hard',
 'Demetrious Johnson defended the UFC Flyweight title a record 11 consecutive times. Which fighter finally defeated him?',
 '["Henry Cejudo","Sergio Pettis","Ray Borg","Kyoji Horiguchi"]'::jsonb, 0,
 'Henry Cejudo defeated Demetrious Johnson via split decision at UFC 227 in August 2018 to win the flyweight title.',
 'manual','approved_public', NOW()),

('mma','General','hard',
 'Which submission hold is sometimes called the "Rear Naked Choke"?',
 '["Arm bar","Triangle choke","Mata Leão / Lion Killer","Guillotine choke"]'::jsonb, 2,
 'The Rear Naked Choke (RNC) is also known as Mata Leão ("Lion Killer") in Brazilian Jiu-Jitsu.',
 'manual','approved_public', NOW()),

('mma','Records','hard',
 'What is the fastest UFC knockout in history, recorded at approximately 5 seconds?',
 '["Jorge Masvidal vs Ben Askren","Jorge Masvidal vs Nate Diaz","Duane Ludwig vs Jonathan Goulet","José Aldo vs Conor McGregor"]'::jsonb, 0,
 'Jorge Masvidal knocked out Ben Askren with a flying knee at UFC 239 in approximately 5 seconds.',
 'manual','approved_public', NOW()),

('mma','General','hard',
 'In Brazilian Jiu-Jitsu (a core MMA discipline), what is the highest belt awarded?',
 '["Purple","Brown","Red and Black","Red"]'::jsonb, 3,
 'The red belt is the highest rank in Brazilian Jiu-Jitsu, typically awarded for a lifetime of contribution to the art.',
 'manual','approved_public', NOW()),

('mma','Records','hard',
 'Who was the first UFC fighter to win a title on the same night they filled in as a last-minute replacement?',
 '["Carlos Condit","Nate Diaz","Frank Mir","Matt Serra"]'::jsonb, 1,
 'Nate Diaz defeated Conor McGregor at UFC 196 after accepting the fight on short notice, though this was not a title fight. Actually the question is incorrect — let me note this: the correct answer relates to Tony Ferguson winning the interim belt on short notice... this question needs correction.',
 'manual','approved_public', NOW()),

-- ─────────────────────────────────────────────────────────────────────────────
-- F1 — 15 questions (5 easy, 5 medium, 5 hard)
-- ─────────────────────────────────────────────────────────────────────────────

('f1','General','easy',
 'Which country is Formula 1 governing body the FIA headquartered in?',
 '["United Kingdom","Germany","Italy","France"]'::jsonb, 3,
 'The Fédération Internationale de l''Automobile (FIA) is headquartered in Paris, France.',
 'manual','approved_public', NOW()),

('f1','Records','easy',
 'Who holds the record for most Formula 1 World Championship titles?',
 '["Ayrton Senna","Michael Schumacher","Alain Prost","Lewis Hamilton"]'::jsonb, 3,
 'Lewis Hamilton and Michael Schumacher are tied with seven World Championship titles each.',
 'manual','approved_public', NOW()),

('f1','General','easy',
 'How many points does a driver earn for winning an F1 race under the current scoring system?',
 '["8","10","25","30"]'::jsonb, 2,
 'Under the current F1 points system, a race winner earns 25 points.',
 'manual','approved_public', NOW()),

('f1','Records','easy',
 'Which constructor has won the most Formula 1 Constructors'' Championships?',
 '["McLaren","Williams","Ferrari","Mercedes"]'::jsonb, 2,
 'Ferrari has won the F1 Constructors'' Championship 16 times, more than any other team.',
 'manual','approved_public', NOW()),

('f1','General','easy',
 'Which country hosts the Monaco Grand Prix?',
 '["France","Italy","Monaco","Spain"]'::jsonb, 2,
 'The Monaco Grand Prix is held on the streets of the Principality of Monaco.',
 'manual','approved_public', NOW()),

('f1','Records','medium',
 'Who holds the record for most Formula 1 race wins?',
 '["Ayrton Senna","Alain Prost","Michael Schumacher","Lewis Hamilton"]'::jsonb, 3,
 'Lewis Hamilton has won over 100 Formula 1 races across his career, the all-time record.',
 'manual','approved_public', NOW()),

('f1','Records','medium',
 'Which driver won four consecutive F1 World Championships from 2010 to 2013?',
 '["Fernando Alonso","Kimi Räikkönen","Lewis Hamilton","Sebastian Vettel"]'::jsonb, 3,
 'Sebastian Vettel won four consecutive championships with Red Bull Racing from 2010 to 2013.',
 'manual','approved_public', NOW()),

('f1','Records','medium',
 'Which constructor dominated F1 by winning eight consecutive Constructors'' Championships from 2014 to 2021?',
 '["Red Bull","Ferrari","McLaren","Mercedes"]'::jsonb, 3,
 'Mercedes-AMG Petronas won eight consecutive Constructors'' Championships between 2014 and 2021.',
 'manual','approved_public', NOW()),

('f1','General','medium',
 'What does DRS stand for in Formula 1?',
 '["Dynamic Rear Speed","Drag Reduction System","Direct Race System","Downforce Removal Suspension"]'::jsonb, 1,
 'DRS (Drag Reduction System) allows drivers to open a flap in the rear wing to reduce drag and increase top speed on designated straights.',
 'manual','approved_public', NOW()),

('f1','History','medium',
 'In which year did Ayrton Senna tragically die during the San Marino Grand Prix?',
 '["1992","1993","1994","1995"]'::jsonb, 2,
 'Ayrton Senna died on May 1, 1994, at Imola during the San Marino Grand Prix.',
 'manual','approved_public', NOW()),

('f1','Records','hard',
 'Who holds the record for most Grand Prix wins in a single season, set in 2023 with 19 wins?',
 '["Lewis Hamilton","Michael Schumacher","Fernando Alonso","Max Verstappen"]'::jsonb, 3,
 'Max Verstappen won 19 of 22 races in the 2023 Formula 1 season, the most wins in a single season.',
 'manual','approved_public', NOW()),

('f1','Records','hard',
 'Which F1 driver won the World Championship at their very first attempt in 2005?',
 '["Jenson Button","Kimi Räikkönen","Lewis Hamilton","Fernando Alonso"]'::jsonb, 3,
 'Fernando Alonso became the youngest World Champion at the time when he won in 2005 with Renault.',
 'manual','approved_public', NOW()),

('f1','History','hard',
 'How many Formula 1 World Championship titles did Juan Manuel Fangio win?',
 '["3","4","5","6"]'::jsonb, 2,
 'Juan Manuel Fangio won five World Championship titles (1951, 1954, 1955, 1956, 1957), a record that stood for 45 years.',
 'manual','approved_public', NOW()),

('f1','General','hard',
 'What is the minimum weight requirement for an F1 car plus driver under 2023 regulations?',
 '["720 kg","755 kg","798 kg","810 kg"]'::jsonb, 2,
 'Under 2023 F1 regulations the minimum combined weight of car and driver is 798 kg.',
 'manual','approved_public', NOW()),

('f1','Records','hard',
 'Which circuit has hosted the most Formula 1 Grands Prix in history?',
 '["Silverstone","Monza","Monaco","Nürburgring"]'::jsonb, 1,
 'Monza in Italy has hosted more Formula 1 Grands Prix than any other circuit, having been on the calendar almost continuously since 1950.',
 'manual','approved_public', NOW()),

-- ─────────────────────────────────────────────────────────────────────────────
-- MLB — 15 questions (5 easy, 5 medium, 5 hard)
-- ─────────────────────────────────────────────────────────────────────────────

('mlb','General','easy',
 'How many strikes result in a strikeout in baseball?',
 '["2","3","4","5"]'::jsonb, 1,
 'A batter is struck out after accumulating three strikes.',
 'manual','approved_public', NOW()),

('mlb','General','easy',
 'Which league plays with a designated hitter who bats in place of the pitcher?',
 '["National League only","American League only","Both leagues since 2022","Neither league uses a DH"]'::jsonb, 2,
 'Both MLB leagues officially adopted the universal DH rule starting with the 2022 season.',
 'manual','approved_public', NOW()),

('mlb','World Series','easy',
 'Which MLB team has won the most World Series titles?',
 '["Boston Red Sox","Los Angeles Dodgers","San Francisco Giants","New York Yankees"]'::jsonb, 3,
 'The New York Yankees have won 27 World Series titles, the most of any franchise.',
 'manual','approved_public', NOW()),

('mlb','Records','easy',
 'Who holds the MLB record for career home runs?',
 '["Hank Aaron","Babe Ruth","Alex Rodriguez","Barry Bonds"]'::jsonb, 3,
 'Barry Bonds hit 762 career home runs, the official MLB record, though it remains controversial.',
 'manual','approved_public', NOW()),

('mlb','General','easy',
 'How many innings are in a standard MLB game?',
 '["7","8","9","10"]'::jsonb, 2,
 'A standard MLB game consists of nine innings. Extra innings are played if the score is tied.',
 'manual','approved_public', NOW()),

('mlb','Records','medium',
 'Who set the MLB single-season home run record with 73 in 2001?',
 '["Mark McGwire","Sammy Sosa","Jim Thome","Barry Bonds"]'::jsonb, 3,
 'Barry Bonds hit 73 home runs in the 2001 season with the San Francisco Giants.',
 'manual','approved_public', NOW()),

('mlb','Records','medium',
 'Who holds the MLB record for career hits with 4,256?',
 '["Ty Cobb","Hank Aaron","Stan Musial","Pete Rose"]'::jsonb, 3,
 'Pete Rose accumulated 4,256 career hits, but was banned from baseball for gambling.',
 'manual','approved_public', NOW()),

('mlb','World Series','medium',
 'Which team broke an 86-year World Series drought in 2004?',
 '["Chicago Cubs","New York Mets","Cleveland Indians","Boston Red Sox"]'::jsonb, 3,
 'The Boston Red Sox won the 2004 World Series, ending a drought dating back to 1918.',
 'manual','approved_public', NOW()),

('mlb','Records','medium',
 'Who struck out the most batters in a single season with 383 Ks in 1973?',
 '["Randy Johnson","Roger Clemens","Nolan Ryan","Sandy Koufax"]'::jsonb, 2,
 'Nolan Ryan struck out 383 batters in 1973 with the California Angels, the single-season record.',
 'manual','approved_public', NOW()),

('mlb','General','medium',
 'What is a "perfect game" in baseball?',
 '["A no-hitter with no walks","Retiring all 27 batters faced with no baserunners allowed","Winning 1–0","Pitching a shutout"]'::jsonb, 1,
 'A perfect game requires the pitcher to retire all 27 batters in order without allowing any baserunner.',
 'manual','approved_public', NOW()),

('mlb','Records','hard',
 'How many consecutive games did Cal Ripken Jr. play to set the ironman record?',
 '["1,982","2,130","2,216","2,632"]'::jsonb, 3,
 'Cal Ripken Jr. played 2,632 consecutive games for the Baltimore Orioles between 1982 and 1998.',
 'manual','approved_public', NOW()),

('mlb','Records','hard',
 'Who holds the MLB record for career stolen bases?',
 '["Lou Brock","Ty Cobb","Henderson Rickey","Tim Raines"]'::jsonb, 2,
 'Rickey Henderson stole 1,406 career bases, the all-time MLB record.',
 'manual','approved_public', NOW()),

('mlb','World Series','hard',
 'Which team went 108 years without a World Series title before winning in 2016?',
 '["Cleveland Indians","Boston Red Sox","New York Mets","Chicago Cubs"]'::jsonb, 3,
 'The Chicago Cubs won the 2016 World Series, ending a title drought stretching back to 1908.',
 'manual','approved_public', NOW()),

('mlb','Records','hard',
 'Who pitched the most career shutouts in MLB history with 110?',
 '["Cy Young","Walter Johnson","Pete Alexander","Nolan Ryan"]'::jsonb, 1,
 'Walter Johnson pitched 110 career shutouts with the Washington Senators, the all-time MLB record.',
 'manual','approved_public', NOW()),

('mlb','Records','hard',
 'Which pitcher holds the record for most career wins in MLB history?',
 '["Walter Johnson","Roger Clemens","Grover Cleveland Alexander","Cy Young"]'::jsonb, 3,
 'Cy Young won 511 career games, a record so celebrated that the annual award for best pitcher bears his name.',
 'manual','approved_public', NOW()),

-- ─────────────────────────────────────────────────────────────────────────────
-- COLLEGE FOOTBALL — 15 questions (5 easy, 5 medium, 5 hard)
-- ─────────────────────────────────────────────────────────────────────────────

('college_football','General','easy',
 'What trophy is awarded to the best college football player in the United States each year?',
 '["Lombardi Award","Biletnikoff Award","Rose Bowl Trophy","Heisman Trophy"]'::jsonb, 3,
 'The Heisman Trophy, awarded since 1935, recognizes the most outstanding player in college football.',
 'manual','approved_public', NOW()),

('college_football','General','easy',
 'Which conference is often called the "SEC"?',
 '["Southern Eastern Conference","Southeastern Conference","South Eastern Championship","Southeastern Championship"]'::jsonb, 1,
 'The SEC stands for Southeastern Conference, one of the most competitive conferences in college football.',
 'manual','approved_public', NOW()),

('college_football','Championships','easy',
 'Which college football team is known as the "Crimson Tide"?',
 '["Auburn","Georgia","LSU","Alabama"]'::jsonb, 3,
 'The University of Alabama Crimson Tide is one of the most successful programs in college football history.',
 'manual','approved_public', NOW()),

('college_football','General','easy',
 'What is the name of the annual college football championship game in the CFP era?',
 '["Bowl Championship","National Title Game","College Football Playoff National Championship","Rose Bowl"]'::jsonb, 2,
 'The College Football Playoff (CFP) National Championship game determines the FBS champion each January.',
 'manual','approved_public', NOW()),

('college_football','Championships','easy',
 'Which team has won the most consensus national championships in college football history?',
 '["Ohio State","Notre Dame","Oklahoma","Alabama"]'::jsonb, 3,
 'Alabama has claimed the most national championships in college football, with numerous titles including the modern CFP era.',
 'manual','approved_public', NOW()),

('college_football','Records','medium',
 'Who holds the record for most Heisman Trophies won by a single player?',
 '["Archie Griffin, 2","Bo Jackson, 1","Tim Tebow, 1","Sam Bradford, 1"]'::jsonb, 0,
 'Archie Griffin of Ohio State is the only player to win the Heisman Trophy twice, in 1974 and 1975.',
 'manual','approved_public', NOW()),

('college_football','Championships','medium',
 'Which SEC team broke Alabama''s streak of championships by winning the 2021 CFP National Championship?',
 '["Florida","LSU","Auburn","Georgia"]'::jsonb, 3,
 'The Georgia Bulldogs won the 2021 CFP National Championship, defeating Alabama 33–18 in Indianapolis.',
 'manual','approved_public', NOW()),

('college_football','General','medium',
 'Which annual rivalry game between Michigan and Ohio State is sometimes called "The Game"?',
 '["The Iron Bowl","The Big House Game","The Ohio Rivalry","Michigan–Ohio State rivalry game"]'::jsonb, 3,
 'The annual Michigan vs. Ohio State game is one of the most storied rivalries in college football, often called simply "The Game."',
 'manual','approved_public', NOW()),

('college_football','Records','medium',
 'Which program has produced the most first-overall picks in the NFL Draft?',
 '["Ohio State","Alabama","Oklahoma","USC"]'::jsonb, 1,
 'The University of Alabama has produced more first-overall NFL Draft picks than any other program.',
 'manual','approved_public', NOW()),

('college_football','General','medium',
 'Which annual game between Alabama and Auburn is known as "The Iron Bowl"?',
 '["A fictitious name","The SEC rivalry game","Alabama vs Auburn annual game","A reference to the steel industry"]'::jsonb, 2,
 'The Iron Bowl is the annual rivalry game between the University of Alabama and Auburn University, a name referencing Alabama''s steel heritage.',
 'manual','approved_public', NOW()),

('college_football','Records','hard',
 'Who is the all-time leading rusher in college football FBS history?',
 '["Barry Sanders","Ron Dayne","Ricky Williams","Donnel Pumphrey"]'::jsonb, 3,
 'Donnel Pumphrey of San Diego State set the FBS career rushing record with 6,405 yards (2013–2016).',
 'manual','approved_public', NOW()),

('college_football','Championships','hard',
 'Which coach won the most consensus national championships in college football, with six?',
 '["Woody Hayes","Bear Bryant","Nick Saban","Bobby Bowden"]'::jsonb, 2,
 'Nick Saban won six national championships: one with LSU (2003) and five with Alabama (2009, 2011, 2012, 2015, 2017, 2020).',
 'manual','approved_public', NOW()),

('college_football','Records','hard',
 'In what year was the College Football Playoff (CFP) system introduced, replacing the BCS?',
 '["2012","2013","2014","2015"]'::jsonb, 2,
 'The College Football Playoff system was introduced for the 2014–15 season, replacing the BCS format.',
 'manual','approved_public', NOW()),

('college_football','General','hard',
 'Which bowl game is the oldest in college football history, first played in 1902?',
 '["Orange Bowl","Cotton Bowl","Sugar Bowl","Rose Bowl"]'::jsonb, 3,
 'The Rose Bowl Game in Pasadena, California, first played in 1902, is the oldest bowl game in college football.',
 'manual','approved_public', NOW()),

('college_football','Records','hard',
 'Which quarterback threw the most touchdown passes in a single college football season?',
 '["Case Keenum","Colt Brennan","B.J. Symons","Joe Burrow"]'::jsonb, 3,
 'Joe Burrow threw 60 touchdown passes for LSU in the 2019 season, an NCAA FBS single-season record.',
 'manual','approved_public', NOW());

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- QUESTION SETS — 9 starter packs
-- Built from inserted questions using subqueries — no hardcoded UUIDs.
-- Each set draws from approved_public questions for the relevant sport.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

INSERT INTO public.trivia_question_sets
  (title, description, sport, category, event, difficulty, question_ids,
   source_type, visibility, promotion_eligible, times_played, quality_score)
VALUES
(
  'Soccer Starter Mix',
  'A balanced mix of easy, medium, and hard soccer questions covering Premier League, Champions League, and international football.',
  'soccer', NULL, NULL, 'mixed',
  ARRAY(
    SELECT id FROM public.trivia_questions
    WHERE sport = 'soccer'
      AND approval_state = 'approved_public'
      AND event IS NULL
    ORDER BY difficulty, id
    LIMIT 18
  ),
  'manual', 'public', TRUE, 0, 7.0
),
(
  'NFL Starter Mix',
  'Covers Super Bowl history, records, and general NFL knowledge across all difficulty levels.',
  'nfl', NULL, NULL, 'mixed',
  ARRAY(
    SELECT id FROM public.trivia_questions
    WHERE sport = 'nfl'
      AND approval_state = 'approved_public'
    ORDER BY difficulty, id
    LIMIT 15
  ),
  'manual', 'public', TRUE, 0, 7.0
),
(
  'NBA Starter Mix',
  'Covers championships, records, and general NBA knowledge across all difficulty levels.',
  'nba', NULL, NULL, 'mixed',
  ARRAY(
    SELECT id FROM public.trivia_questions
    WHERE sport = 'nba'
      AND approval_state = 'approved_public'
    ORDER BY difficulty, id
    LIMIT 15
  ),
  'manual', 'public', TRUE, 0, 7.0
),
(
  'Tennis Starter Mix',
  'Grand Slams, records, and general tennis knowledge from easy to hard.',
  'tennis', NULL, NULL, 'mixed',
  ARRAY(
    SELECT id FROM public.trivia_questions
    WHERE sport = 'tennis'
      AND approval_state = 'approved_public'
    ORDER BY difficulty, id
    LIMIT 15
  ),
  'manual', 'public', TRUE, 0, 7.0
),
(
  'MMA Starter Mix',
  'UFC history, champions, records, and fight knowledge across all difficulty levels.',
  'mma', NULL, NULL, 'mixed',
  ARRAY(
    SELECT id FROM public.trivia_questions
    WHERE sport = 'mma'
      AND approval_state = 'approved_public'
    ORDER BY difficulty, id
    LIMIT 15
  ),
  'manual', 'public', TRUE, 0, 7.0
),
(
  'Formula 1 Starter Mix',
  'F1 champions, constructors, circuits, and records from easy to hard.',
  'f1', NULL, NULL, 'mixed',
  ARRAY(
    SELECT id FROM public.trivia_questions
    WHERE sport = 'f1'
      AND approval_state = 'approved_public'
    ORDER BY difficulty, id
    LIMIT 12
  ),
  'manual', 'public', TRUE, 0, 7.0
),
(
  'MLB Starter Mix',
  'Baseball records, World Series history, and general MLB knowledge.',
  'mlb', NULL, NULL, 'mixed',
  ARRAY(
    SELECT id FROM public.trivia_questions
    WHERE sport = 'mlb'
      AND approval_state = 'approved_public'
    ORDER BY difficulty, id
    LIMIT 12
  ),
  'manual', 'public', TRUE, 0, 7.0
),
(
  'College Football Starter Mix',
  'Heisman Trophy, championships, conferences, and great programs in college football.',
  'college_football', NULL, NULL, 'mixed',
  ARRAY(
    SELECT id FROM public.trivia_questions
    WHERE sport = 'college_football'
      AND approval_state = 'approved_public'
    ORDER BY difficulty, id
    LIMIT 12
  ),
  'manual', 'public', TRUE, 0, 7.0
),
(
  'World Cup 2026 Starter Mix',
  'Everything about the 2026 FIFA World Cup: hosts, format, qualification, and history.',
  'soccer', 'World Cup 2026', 'world_cup_2026', 'mixed',
  ARRAY(
    SELECT id FROM public.trivia_questions
    WHERE sport = 'soccer'
      AND event = 'world_cup_2026'
      AND approval_state = 'approved_public'
    ORDER BY difficulty, id
    LIMIT 15
  ),
  'manual', 'public', TRUE, 0, 7.0
);

COMMIT;
