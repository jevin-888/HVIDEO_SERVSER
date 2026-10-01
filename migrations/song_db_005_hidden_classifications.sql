-- Apply once. Administrators may explicitly show these categories afterwards.
UPDATE dicts SET visible=0
WHERE dictGroup='classify' AND (
    dictCode IN ('0','2','3','4','5','6','7','13','17','72','73','74','75','76','77','78')
    OR dictName IN ('其他','其它','戏曲','黃梅戲','黄梅戏','京剧','京劇','沪剧','滬劇','越剧','越劇','川剧','川劇','豫剧','豫劇','潮剧','潮劇','歌剧','歌劇','琼剧','瓊劇','淮剧','淮劇','粤剧','粵劇','花鼓戏','花鼓戲','秦腔','粤曲','粵曲')
);
