ConversateProJapanese — experimental clone

This project is intentionally separate from ConversateProArabic.

Main language directions
- English -> Japanese: en-ja
- Japanese -> English: ja-en

Japanese AI rules
- Natural modern Japanese.
- Fine-grained breakdowns.
- Particles are normally separate learning units.
- Romaji uses readable Hepburn-style pronunciation.
- は -> wa when used as the topic particle.
- へ -> e when used as the direction particle.
- を -> o when used as the object particle.
- Normal inflected verbs such as 行きました stay together by default.
- Japanese displays horizontally left-to-right in this app.

Example breakdown
私は学校に行きました。

私          watashi      I
は          wa           topic marker
学校        gakkō        school
に          ni           to
行きました  ikimashita   went

Flexible inputs that should work
- I went to school.
- 私は学校に行きました。
- watashi wa gakkou ni ikimashita
- watashi wa gakko ni ikimashita

Firebase
The same Firebase project configuration is used, but this Japanese experiment uses separate collections and browser session keys:
- conversateJapanese_accounts
- conversateJapanese_users
- conversateproJapanese.session.v1

That prevents Japanese rooms/accounts from overwriting the Arabic experiment.

OpenAI environment variables
- OPENAI_API_KEY is required.
- OPENAI_MODEL is optional. If omitted, api/ai.js uses gpt-6-luna.

Dictionary
The Arabic static dictionary was NOT copied into this project because its Arabic vocabulary data is not appropriate for Japanese. The Japanese app is ready for a separate Japanese static dictionary later without changing the core sentence/paragraph architecture.
