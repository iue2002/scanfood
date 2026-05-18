-- MySQL dump 10.13  Distrib 8.4.7, for Win64 (x86_64)
--
-- Host: 127.0.0.1    Database: scanfood
-- ------------------------------------------------------
-- Server version	8.4.7

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `__drizzle_migrations`
--

DROP TABLE IF EXISTS `__drizzle_migrations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `__drizzle_migrations` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `hash` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` bigint DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `id` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `__drizzle_migrations`
--

LOCK TABLES `__drizzle_migrations` WRITE;
/*!40000 ALTER TABLE `__drizzle_migrations` DISABLE KEYS */;
INSERT INTO `__drizzle_migrations` VALUES (1,'b7e4eeaf8dbe1796af2976866be4a58c6d8b56ab99aef9ecc43bcf1ef349bc13',1778961413132);
/*!40000 ALTER TABLE `__drizzle_migrations` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `dish_categories`
--

DROP TABLE IF EXISTS `dish_categories`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `dish_categories` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  KEY `dish_categories_sort_order_idx` (`sort_order`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `dish_categories`
--

LOCK TABLES `dish_categories` WRITE;
/*!40000 ALTER TABLE `dish_categories` DISABLE KEYS */;
INSERT INTO `dish_categories` VALUES (1,'烧烤',0,'2026-05-14 15:09:50','2026-05-14 15:09:50'),(3,'酒水',0,'2026-05-18 09:20:46','2026-05-18 09:20:46'),(4,'主食',0,'2026-05-18 09:21:21','2026-05-18 09:21:21');
/*!40000 ALTER TABLE `dish_categories` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `dish_specs`
--

DROP TABLE IF EXISTS `dish_specs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `dish_specs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `dish_id` int NOT NULL,
  `spec_name` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `price` decimal(10,2) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  KEY `dish_specs_dish_id_idx` (`dish_id`),
  CONSTRAINT `dish_specs_dish_id_dishes_id_fk` FOREIGN KEY (`dish_id`) REFERENCES `dishes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `dish_specs`
--

LOCK TABLES `dish_specs` WRITE;
/*!40000 ALTER TABLE `dish_specs` DISABLE KEYS */;
/*!40000 ALTER TABLE `dish_specs` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `dishes`
--

DROP TABLE IF EXISTS `dishes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `dishes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `category_id` int NOT NULL,
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `image_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `price` decimal(10,2) NOT NULL,
  `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'available',
  `sort_order` int NOT NULL DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  KEY `dishes_category_id_idx` (`category_id`),
  KEY `dishes_status_idx` (`status`),
  KEY `dishes_sort_order_idx` (`sort_order`),
  CONSTRAINT `dishes_category_id_dish_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `dish_categories` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `dishes`
--

LOCK TABLES `dishes` WRITE;
/*!40000 ALTER TABLE `dishes` DISABLE KEYS */;
INSERT INTO `dishes` VALUES (4,1,'羊肉串',NULL,'http://localhost:3000/uploads/compressed_97bd3daa-56fe-41e4-9cf3-42e27c1a53cf.jpg',5.00,'available',0,'2026-05-14 15:10:28','2026-05-14 15:10:28'),(5,1,'鱼豆腐',NULL,'http://localhost:3000/uploads/5c588948-96c2-41bd-8ecf-4d050f897734.jpg',3.00,'available',0,'2026-05-15 15:36:20','2026-05-15 15:36:20'),(6,1,'香肠',NULL,'http://localhost:3000/uploads/compressed_a6c88ed8-41fa-4461-8d75-2227dbfd5b92.jpg',3.00,'available',0,'2026-05-18 09:17:26','2026-05-18 09:17:26'),(7,4,'烤包子',NULL,'http://localhost:3000/uploads/compressed_4aab76ea-6ba2-408d-82b9-4fb97e4871f0.jpg',5.00,'available',0,'2026-05-18 09:21:15','2026-05-18 09:21:15');
/*!40000 ALTER TABLE `dishes` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `health_check`
--

DROP TABLE IF EXISTS `health_check`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `health_check` (
  `id` int NOT NULL AUTO_INCREMENT,
  `updated_at` timestamp NULL DEFAULT (now()),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `health_check`
--

LOCK TABLES `health_check` WRITE;
/*!40000 ALTER TABLE `health_check` DISABLE KEYS */;
/*!40000 ALTER TABLE `health_check` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `order_items`
--

DROP TABLE IF EXISTS `order_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `order_items` (
  `id` int NOT NULL AUTO_INCREMENT,
  `order_id` int NOT NULL,
  `dish_id` int NOT NULL,
  `spec_id` int DEFAULT NULL,
  `dish_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `spec_name` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `quantity` int NOT NULL DEFAULT '1',
  `price` decimal(10,2) NOT NULL,
  `subtotal` decimal(10,2) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `added_by_user_id` int DEFAULT NULL,
  `added_by_nickname` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `phase` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'order',
  `add_more_round` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `order_items_spec_id_dish_specs_id_fk` (`spec_id`),
  KEY `order_items_order_id_idx` (`order_id`),
  KEY `order_items_dish_id_idx` (`dish_id`),
  KEY `order_items_added_by_user_id_idx` (`added_by_user_id`),
  CONSTRAINT `order_items_added_by_user_id_users_id_fk` FOREIGN KEY (`added_by_user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `order_items_dish_id_dishes_id_fk` FOREIGN KEY (`dish_id`) REFERENCES `dishes` (`id`),
  CONSTRAINT `order_items_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE,
  CONSTRAINT `order_items_spec_id_dish_specs_id_fk` FOREIGN KEY (`spec_id`) REFERENCES `dish_specs` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2261 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `order_items`
--

LOCK TABLES `order_items` WRITE;
/*!40000 ALTER TABLE `order_items` DISABLE KEYS */;
INSERT INTO `order_items` VALUES (2255,1942,4,NULL,'羊肉串',NULL,1,5.00,5.00,'2026-05-18 09:31:43',33,'iu ɛɛam','order',0),(2256,1942,7,NULL,'烤包子',NULL,1,5.00,5.00,'2026-05-18 09:31:43',33,'iu ɛɛam','order',0),(2257,1942,7,NULL,'烤包子',NULL,1,5.00,5.00,'2026-05-18 09:32:16',33,'iu ɛɛam','add_more',1),(2258,1943,4,NULL,'羊肉串',NULL,1,5.00,5.00,'2026-05-18 09:48:36',33,'iu ɛɛam','order',0),(2259,1943,7,NULL,'烤包子',NULL,1,5.00,5.00,'2026-05-18 09:48:36',33,'iu ɛɛam','order',0),(2260,1943,7,NULL,'烤包子',NULL,1,5.00,5.00,'2026-05-18 09:48:36',33,'iu ɛɛam','order',0);
/*!40000 ALTER TABLE `order_items` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `orders`
--

DROP TABLE IF EXISTS `orders`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `orders` (
  `id` int NOT NULL AUTO_INCREMENT,
  `table_id` int NOT NULL,
  `order_number` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `total_amount` decimal(10,2) NOT NULL DEFAULT '0.00',
  `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'submitted',
  `user_id` int DEFAULT NULL,
  `remark` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `printed_at` timestamp NULL DEFAULT NULL,
  `settled_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  UNIQUE KEY `orders_order_number_unique` (`order_number`),
  KEY `orders_table_id_idx` (`table_id`),
  KEY `orders_order_number_idx` (`order_number`),
  KEY `orders_status_idx` (`status`),
  KEY `orders_user_id_idx` (`user_id`),
  KEY `orders_created_at_idx` (`created_at`),
  CONSTRAINT `orders_table_id_tables_id_fk` FOREIGN KEY (`table_id`) REFERENCES `tables` (`id`),
  CONSTRAINT `orders_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=1944 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `orders`
--

LOCK TABLES `orders` WRITE;
/*!40000 ALTER TABLE `orders` DISABLE KEYS */;
INSERT INTO `orders` VALUES (1942,38,'ORD20260518702196',15.00,'settled',33,NULL,'2026-05-18 01:32:17','2026-05-18 01:32:27','2026-05-18 09:31:42','2026-05-18 01:32:17'),(1943,38,'ORD20260518716801',15.00,'settled',33,NULL,'2026-05-18 01:48:37','2026-05-18 01:48:50','2026-05-18 09:48:36','2026-05-18 09:48:36');
/*!40000 ALTER TABLE `orders` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `print_records`
--

DROP TABLE IF EXISTS `print_records`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `print_records` (
  `id` int NOT NULL AUTO_INCREMENT,
  `order_id` int NOT NULL,
  `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `error_message` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `printed_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  KEY `print_records_order_id_idx` (`order_id`),
  KEY `print_records_status_idx` (`status`),
  CONSTRAINT `print_records_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=1964 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `print_records`
--

LOCK TABLES `print_records` WRITE;
/*!40000 ALTER TABLE `print_records` DISABLE KEYS */;
INSERT INTO `print_records` VALUES (1962,1942,'success',NULL,'2026-05-18 01:32:17','2026-05-18 09:32:16'),(1963,1943,'success',NULL,'2026-05-18 01:48:37','2026-05-18 09:48:36');
/*!40000 ALTER TABLE `print_records` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `refunds`
--

DROP TABLE IF EXISTS `refunds`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `refunds` (
  `id` int NOT NULL AUTO_INCREMENT,
  `order_id` int NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `reason` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `operator_id` int NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  KEY `refunds_operator_id_users_id_fk` (`operator_id`),
  KEY `refunds_order_id_idx` (`order_id`),
  KEY `refunds_status_idx` (`status`),
  CONSTRAINT `refunds_operator_id_users_id_fk` FOREIGN KEY (`operator_id`) REFERENCES `users` (`id`),
  CONSTRAINT `refunds_order_id_orders_id_fk` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `refunds`
--

LOCK TABLES `refunds` WRITE;
/*!40000 ALTER TABLE `refunds` DISABLE KEYS */;
/*!40000 ALTER TABLE `refunds` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `store_settings`
--

DROP TABLE IF EXISTS `store_settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `store_settings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `store_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '伊美轩',
  `store_avatar` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `store_settings`
--

LOCK TABLES `store_settings` WRITE;
/*!40000 ALTER TABLE `store_settings` DISABLE KEYS */;
INSERT INTO `store_settings` VALUES (1,'阿卜正宗羊肉烧烤','http://localhost:3000/uploads/compressed_b6ab9f06-7f0f-4069-8310-ac0e9c968976.jpg','2026-05-18 09:57:11','2026-05-18 09:57:11');
/*!40000 ALTER TABLE `store_settings` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `tables`
--

DROP TABLE IF EXISTS `tables`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tables` (
  `id` int NOT NULL AUTO_INCREMENT,
  `table_number` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `capacity` int NOT NULL DEFAULT '4',
  `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'idle',
  `qr_code_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  UNIQUE KEY `tables_table_number_unique` (`table_number`),
  KEY `tables_table_number_idx` (`table_number`),
  KEY `tables_status_idx` (`status`)
) ENGINE=InnoDB AUTO_INCREMENT=39 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `tables`
--

LOCK TABLES `tables` WRITE;
/*!40000 ALTER TABLE `tables` DISABLE KEYS */;
INSERT INTO `tables` VALUES (37,'06',4,'idle','/uploads/qrcode_06_1778916035644.jpg','2026-05-16 07:20:34','2026-05-16 07:20:34'),(38,'01',4,'idle','/uploads/qrcode_01_1778947582307.jpg','2026-05-16 16:06:21','2026-05-16 16:06:21');
/*!40000 ALTER TABLE `tables` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `username` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `password` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `role` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'customer',
  `openid` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `nickname` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `avatar_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `table_number` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  UNIQUE KEY `users_username_unique` (`username`),
  KEY `users_username_idx` (`username`),
  KEY `users_role_idx` (`role`),
  KEY `users_openid_idx` (`openid`)
) ENGINE=InnoDB AUTO_INCREMENT=36 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `users`
--

LOCK TABLES `users` WRITE;
/*!40000 ALTER TABLE `users` DISABLE KEYS */;
INSERT INTO `users` VALUES (1,'admin','$2b$10$rUV6/9o.OQaDmY3.xLipq.w5PsbGKWoOhNXBBRrkNLeNmx/cWN7FS','admin',NULL,'系统管理员',NULL,NULL,'2026-05-14 14:30:29','2026-05-14 14:30:29'),(2,'staff','$2b$10$rUV6/9o.OQaDmY3.xLipq.w5PsbGKWoOhNXBBRrkNLeNmx/cWN7FS','staff',NULL,'前台员工',NULL,NULL,'2026-05-14 14:30:29','2026-05-14 14:30:29'),(33,'wx_orLZ567aph','$2b$10$mVNOcH1poOE1Tqvfkv4VluUKEeL45qgJnoDeEvcVSFn2/15gbiyZ6','customer','orLZ567aphpi1zLW1iOQrzpDkoro','iu ɛɛam','http://tmp/es8K1yIltN1T93df1a37429e571879796000a11557b3.jpeg','01','2026-05-16 05:45:02','2026-05-16 05:45:02'),(34,'wx_orLZ566c9k','$2b$10$CtUvsPyyCB8ZoHc9B1nN2ONST1olPlTk7TeAx9V2SUNWmF0gmQX6e','customer','orLZ566c9k3uc-H_MVC04k_rn9fQ','฿','wxfile://tmp_8cfda034965dd7696d131f09088b66e6.jpg','06','2026-05-16 19:26:02','2026-05-16 19:26:02'),(35,'testuser','$2b$10$WlECJLP2XsjFkxhOzPjEHu4R0GNEcN9WXqJV4ukF7IkE3CzBpGjEC','customer',NULL,'testuser',NULL,NULL,'2026-05-18 08:03:40','2026-05-18 08:03:40');
/*!40000 ALTER TABLE `users` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-05-19  1:01:35
