const { analyzeVedicText } = require("./ontology");

const SEED_DATA = [
  {
    title: "Gayatri Mantra",
    source: "Rigveda",
    rishis: ["Vishvamitra"],
    deities: ["Savitr"],
    text: "ॐ भूर्भुवः स्वः तत्सवितुर्वरेण्यं भर्गो देवस्य धीमहि धियो यो नः प्रचोदयात्",
    transliteration: "oṃ bhūr bhuvaḥ svaḥ tat savitur vareṇyaṃ bhargo devasya dhīmahi dhiyo yo naḥ pracodayāt",
    concepts: ["Brahman", "Dharma"]
  },
  {
    title: "Isha Upanishad Verse 1",
    source: "Isha Upanishad",
    rishis: ["Yajnavalkya"],
    deities: ["Ishvara"],
    text: "ईशावास्यमिदँ सर्वं यत्किञ्च जगत्यां जगत् । तेन त्यक्तेन भुञ्जीथा मा गृधः कस्यस्विद्धनम् ॥",
    transliteration: "īśāvāsyamidaṃ sarvaṃ yatkiñca jagatyāṃ jagat | tena tyaktena bhuñjīthā mā gṛdhaḥ kasyasviddhanam ||",
    concepts: ["Brahman", "Atman", "Karma"]
  },
  {
    title: "Asatoma Ma Sadgamaya",
    source: "Brihadaranyaka Upanishad",
    rishis: ["Unknown"],
    deities: ["Brahman"],
    text: "असतो मा सद्गमय । तमसो मा ज्योतिर्गमय । मृत्योर्मा अमृतं गमय ॥",
    transliteration: "asato mā sadgamaya | tamaso mā jyotirgamaya | mṛtyormā amṛtaṃ gamaya ||",
    concepts: ["Moksha", "Ananda"]
  }
];

function getSeedData() {
  return SEED_DATA.map(item => ({
    ...item,
    analysis: analyzeVedicText(item.text, item)
  }));
}

module.exports = {
  getSeedData
};
