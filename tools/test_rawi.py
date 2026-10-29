import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
from arabic import key  # noqa: E402
from build_data import end_letters, poem_rawi, start_letter  # noqa: E402


def rawi(*ajuz):
    return poem_rawi([end_letters(a) for a in ajuz])


class RawiTest(unittest.TestCase):
    def test_plain_ending(self):
        self.assertEqual(rawi("بِسِقطِ اللِوى بَينَ الدَخولِ فَحَومَلِ")[0], ("ل", 1))

    def test_alif_of_itlaq_is_skipped(self):
        self.assertEqual(rawi("وَيَأتيكَ بِالأَخبارِ مَن لَم تُزَوَّدا")[0], ("د", 2))

    def test_shared_wasl_and_khuruj(self):
        poem = rawi("وَظِلُّ جَوادي قَيظُها وَعَجاجُها", "إِذا اِشتَبَهَت خُرصانُها وَزِجاجُها",
                    "تَشَبَّثَ بي غيطانُها وَفِجاجُها", "سَيَطلُبُها سَيفي وَديني خَراجُها")
        self.assertEqual(set(poem), {("ج", 3)})

    def test_maqsura_rhyme_stays_alif(self):
        poem = rawi("ما الحُبُّ إِلّا لِلحَبيبِ الهَوى", "وَطالَ بِيَ النَوى", "بَلَغتُ المُنتَهى", "وَلَم أَرَ مِثلَهُ في الوَرى")
        self.assertEqual({r for r, _ in poem}, {"ا"})

    def test_waw_of_plural_with_silent_alif(self):
        poem = rawi("وَلا أَدَبُ", "فَإِن هُمُ ذَهَبَت أَخلاقُهُم ذَهَبوا", "يَنتَسِبُ", "وَالحَسَبُ")
        self.assertEqual(poem[1], ("ب", 3))

    def test_hamza_and_ta_marbuta(self):
        self.assertEqual(rawi("وَداوِني بِالَّتي كانَت هِيَ الداءُ")[0][0], "ا")
        self.assertEqual(rawi("قَد طالَ بي هَمُّ المَحَبَّة")[0][0], "ه")

    def test_start_letter_unifies_hamza(self):
        self.assertEqual(start_letter("أَلا هُبّي بِصَحنِكِ"), "ا")
        self.assertEqual(start_letter("إِذا الشَعبُ"), "ا")

    def test_key_ignores_diacritics_and_spelling_variants(self):
        self.assertEqual(key("قِفا نَبكِ مِن ذِكرى"), key("قفا نبك من ذكري"))
        self.assertEqual(key("أَراكَ عَصِيَّ الدَمعِ"), key("اراك عصي الدمع"))


if __name__ == "__main__":
    unittest.main()
