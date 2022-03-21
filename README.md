## SQL 초기 설정

```sql
CREATE TABLE `user` (
  `uid` char(28) NOT NULL,
  `email` varchar(255) NOT NULL,
  `name` varchar(64) NOT NULL,
  `permission` tinyint NOT NULL DEFAULT '0',
  `loadAll` tinyint NOT NULL DEFAULT '0',
  `highlightChanges` tinyint NOT NULL DEFAULT '1',
  `sortMethod` tinyint NOT NULL DEFAULT '0',
  PRIMARY KEY (`uid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `store` (
  `url` varchar(256) NOT NULL,
  `title` varchar(256) NOT NULL,
  PRIMARY KEY (`url`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO store (url, title) VALUES ('https://n09.co.kr', '엔공구 공식 쇼핑몰'), ('https://hyundai.auton.co.kr', '카라이프몰');

CREATE TABLE `bookmark` (
  `uid` char(28) NOT NULL,
  `storeUrl` varchar(256) NOT NULL,
  PRIMARY KEY (`uid`,`storeUrl`),
  KEY `storeUrl_idx` (`storeUrl`),
  CONSTRAINT `bookmarkStoreUrl` FOREIGN KEY (`storeUrl`) REFERENCES `store` (`url`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci

CREATE TABLE `query` (
  `uid` varchar(45) NOT NULL,
  `storeUrl` varchar(256) NOT NULL,
  `date` date NOT NULL,
  `time` time NOT NULL,
  `type` tinyint NOT NULL,
  `amount` int NOT NULL,
  PRIMARY KEY (`uid`,`storeUrl`,`date`,`type`),
  KEY `queryStoreUrl_idx` (`storeUrl`),
  CONSTRAINT `queryStoreUrl` FOREIGN KEY (`storeUrl`) REFERENCES `store` (`url`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `history` (
  `storeUrl` varchar(256) NOT NULL,
  `time` bigint NOT NULL,
  PRIMARY KEY (`storeUrl`,`time`),
  CONSTRAINT `historyStoreUrl` FOREIGN KEY (`storeUrl`) REFERENCES `store` (`url`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `product` (
  `storeUrl` varchar(256) NOT NULL,
  `time` bigint NOT NULL,
  `id` bigint NOT NULL,
  `title` varchar(256) NOT NULL,
  `price` int NOT NULL,
  `popularityIndex` int NOT NULL,
  `isSoldOut` tinyint NOT NULL,
  `category` varchar(32) DEFAULT NULL,
  PRIMARY KEY (`storeUrl`,`time`,`id`),
  CONSTRAINT `productStoreUrl` FOREIGN KEY (`storeUrl`) REFERENCES `store` (`url`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```