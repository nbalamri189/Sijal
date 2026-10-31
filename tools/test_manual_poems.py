import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(__file__))
from build_data import read_manual_poems, repair  # noqa: E402

POEMS = """الشاعر: شاعر للتجربة
القصيدة: الأولى
المصدر: https://www.aldiwan.net/poem1.html
البحر: الطويل

قِفا نَبكِ مِن ذِكرى حَبيبٍ وَمَنزِلِ
بِسِقطِ اللِوى بَينَ الدَخولِ فَحَومَلِ
---
القصيدة: الثانية

أَلا هُبّي بِصَحنِكِ فَاَصبَحينا * وَلا تُبقي خُمورَ الأَندَرينا
"""


class ManualPoemsTest(unittest.TestCase):
    def read(self, text):
        with tempfile.TemporaryDirectory() as folder:
            with open(os.path.join(folder, "test.txt"), "w", encoding="utf-8") as fh:
                fh.write(text)
            return read_manual_poems(folder)

    def test_headers_and_both_verse_layouts(self):
        df = self.read(POEMS)
        self.assertEqual(list(df["poem title"]), ["الأولى", "الثانية"])
        self.assertEqual(df["poem url"][0], "https://www.aldiwan.net/poem1.html")
        self.assertEqual(df["poem meter"][0], "الطويل")
        self.assertEqual(len(df["poem verses"][0]), 2)
        self.assertEqual(df["poem verses"][1], ["أَلا هُبّي بِصَحنِكِ فَاَصبَحينا", "وَلا تُبقي خُمورَ الأَندَرينا"])

    def test_later_poems_inherit_the_poet(self):
        self.assertEqual(list(self.read(POEMS)["poet name"]), ["شاعر للتجربة"] * 2)

    def test_odd_hemistich_count_stops_the_build(self):
        with self.assertRaises(SystemExit):
            self.read("الشاعر: شاعر\n\nصدر بلا عجز يكمله\n")


class RepairTest(unittest.TestCase):
    def test_stray_line_is_dropped(self):
        ajuz = ["بِسِقطِ اللِوى بَينَ الدَخولِ فَحَومَلِ", "لِما نَسَجَتها مِن جَنوبٍ وَشَمأَلِ", "وَقيعانِها كَأَنَّهُ حَبُّ فُلفُلِ"]
        lines = []
        for i, a in enumerate(ajuz):
            lines += [f"{i + 1} - صدر البيت رقم {i + 1} هنا", a]
        pairs = repair(lines[:2] + ["***"] + lines[2:])
        self.assertEqual([a for _, a in pairs], ajuz)
        self.assertEqual(pairs[0][0], "صدر البيت رقم 1 هنا")

    def test_pairing_that_does_not_rhyme_is_rejected(self):
        lines = ["سطر أول من القصيدة", "سطر ثان ينتهي بالراء", "سطر ثالث ينتهي بالباء", "سطر رابع ينتهي بالسين",
                 "سطر خامس ينتهي بالميم", "سطر سادس ينتهي بالدال", "."]
        self.assertIsNone(repair(lines))


if __name__ == "__main__":
    unittest.main()
